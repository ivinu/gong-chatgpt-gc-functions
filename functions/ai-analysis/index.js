// functions/ai-analysis/index.js - Enhanced AI analysis function
const functions = require('@google-cloud/functions-framework');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');

// Initialize clients
const secretClient = new SecretManagerServiceClient();
const firestore = new Firestore();

// Cache for secrets
let secretsCache = {};
let lastSecretRefresh = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * AI Analysis Handler - Enhanced version of your Vercel ai-analysis function
 */
functions.http('aiAnalysisHandler', async (req, res) => {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { callIds, callId, analysisType = 'full' } = req.body;
    
    let targetCallIds = [];
    if (callIds && Array.isArray(callIds)) targetCallIds = callIds;
    else if (callId) targetCallIds = [callId];
    
    if (targetCallIds.length === 0) {
      return res.status(400).json({ 
        error: 'Call IDs required',
        message: 'Please provide callIds array or single callId'
      });
    }

    console.log('AI analysis for calls:', targetCallIds, 'Type:', analysisType);
    
    // Get secrets
    const secrets = await getSecrets();
    const gongConfig = createGongConfig(secrets);
    
    // Get transcripts
    const transcripts = await getGongTranscripts(targetCallIds, gongConfig);
    if (!transcripts || transcripts.length === 0) {
      return res.status(404).json({ error: 'No transcripts found' });
    }
    
    const results = [];
    
    for (const transcript of transcripts) {
      const conversationText = extractConversationText(transcript.transcript);
      
      if (!conversationText || conversationText.length < 100) {
        results.push({
          callId: transcript.callId,
          error: 'Insufficient transcript content'
        });
        continue;
      }
      
      try {
        let analysis;
        
        switch (analysisType) {
          case 'summary':
            analysis = await generateCallSummary(conversationText, transcript.callId, gongConfig);
            break;
          case 'sentiment':
            analysis = await analyzeSentiment(conversationText);
            break;
          case 'full':
          default:
            analysis = await analyzeWithOpenAI(conversationText);
            break;
        }
        
        // Store analysis in Firestore for future reference
        await storeAnalysis(transcript.callId, analysis, analysisType);
        
        results.push({
          callId: transcript.callId,
          analysis: analysis,
          analysisType: analysisType,
          processedAt: new Date().toISOString()
        });
        
        // Rate limiting to avoid API limits
        await sleep(1000);
        
      } catch (error) {
        console.error(`AI analysis failed for call ${transcript.callId}:`, error);
        results.push({
          callId: transcript.callId,
          error: 'AI analysis failed',
          details: error.message
        });
      }
    }
    
    res.status(200).json({ 
      results,
      summary: {
        totalRequested: targetCallIds.length,
        successful: results.filter(r => !r.error).length,
        failed: results.filter(r => r.error).length,
        analysisType: analysisType
      }
    });
    
  } catch (error) {
    console.error('AI analysis error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

/**
 * Batch Analysis Handler - Process multiple calls efficiently
 */
functions.http('batchAnalysis', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { callIds, batchSize = 5 } = req.body;
    
    if (!callIds || !Array.isArray(callIds)) {
      return res.status(400).json({ error: 'callIds array required' });
    }

    console.log(`Starting batch analysis for ${callIds.length} calls`);
    
    const secrets = await getSecrets();
    const gongConfig = createGongConfig(secrets);
    
    // Process in batches to avoid overwhelming the API
    const batches = [];
    for (let i = 0; i < callIds.length; i += batchSize) {
      batches.push(callIds.slice(i, i + batchSize));
    }
    
    const allResults = [];
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} calls)`);
      
      try {
        const batchResults = await processBatch(batch, gongConfig);
        allResults.push(...batchResults);
        
        // Wait between batches
        if (i < batches.length - 1) {
          await sleep(2000);
        }
      } catch (error) {
        console.error(`Batch ${i + 1} failed:`, error);
        // Add error results for failed batch
        batch.forEach(callId => {
          allResults.push({
            callId,
            error: 'Batch processing failed',
            details: error.message
          });
        });
      }
    }
    
    res.status(200).json({
      results: allResults,
      summary: {
        totalCalls: callIds.length,
        totalBatches: batches.length,
        successful: allResults.filter(r => !r.error).length,
        failed: allResults.filter(r => r.error).length
      }
    });
    
  } catch (error) {
    console.error('Batch analysis error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Helper Functions

async function getGongTranscripts(callIds, gongConfig) {
  const response = await axios.post(`${gongConfig.baseUrl}/calls/transcript`, {
    filter: {
      callIds: callIds,
      fromDateTime: "2023-01-01T00:00:00Z",
      toDateTime: "2025-12-31T23:59:59Z"
    }
  }, {
    headers: gongConfig.headers,
    timeout: 30000
  });
  
  return response.data.callTranscripts || [];
}

function extractConversationText(transcriptArray) {
  if (!Array.isArray(transcriptArray)) return '';
  
  const conversation = [];
  const speakerMap = new Map();
  
  for (const entry of transcriptArray) {
    if (entry.sentences && Array.isArray(entry.sentences)) {
      const speakerId = entry.speakerId;
      let speakerName = `Speaker_${speakerId}`;
      
      if (!speakerMap.has(speakerId)) {
        const speakerNumber = speakerMap.size + 1;
        speakerName = `Speaker${speakerNumber}`;
        speakerMap.set(speakerId, speakerName);
      } else {
        speakerName = speakerMap.get(speakerId);
      }
      
      for (const sentence of entry.sentences) {
        if (sentence.text?.trim()) {
          conversation.push(`${speakerName}: ${sentence.text.trim()}`);
        }
      }
    }
  }
  
  return conversation.join('\n');
}

async function analyzeWithOpenAI(conversationText) {
  const secrets = await getSecrets();
  const openaiKey = secrets.openaiKey;
  
  if (!openaiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  // Enhanced prompt based on your existing implementation
  const prompt = `Analyze this COMPLETE sales call transcript and provide accurate insights based on the entire conversation: ${conversationText.substring(0, 4000)}

{
  "sentiment": "Positive|Negative|Neutral",
  "confidence": 0.85,
  "reasoning": "Brief reason based on actual conversation content",
  "landingPoint": {
    "currentStage": "Discovery|Demo|Proposal|Negotiation|Closing",
    "nextSteps": "Specific actions mentioned or agreed upon in the conversation",
    "hurdles": "Actual obstacles discussed in the conversation",
    "timeline": "Timeline mentioned in the conversation or realistic assessment"
  },
  "actionItems": [
    {
      "task": "Specific action mentioned or committed to in the conversation",
      "owner": "Person who actually committed to this in the call",
      "urgency": "High|Medium|Low",
      "context": "Why this was discussed and what it will achieve"
    }
  ],
  "keyQuote": "Exact quote from the conversation that best represents the customer's position",
  "businessInsights": {
    "qualificationLevel": "High|Medium|Low",
    "buyingSignals": ["List of positive indicators"],
    "concerns": ["List of customer concerns"],
    "competitorMentions": ["Competitors discussed"],
    "decisionMakers": ["People involved in decision making"]
  }
}`;

  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4-turbo-preview',
    messages: [
      { role: 'system', content: 'You are a sales analyst. Return only valid JSON.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 1200,
    temperature: 0.3,
    response_format: { type: "json_object" }
  }, {
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
  
  return JSON.parse(response.data.choices[0].message.content);
}

async function generateCallSummary(conversationText, callId, gongConfig) {
  // Get call details first
  const callResponse = await axios.get(`${gongConfig.baseUrl}/calls`, {
    headers: gongConfig.headers,
    params: {
      fromDateTime: "2023-01-01T00:00:00Z",
      toDateTime: "2025-12-31T23:59:59Z"
    }
  });
  
  const call = callResponse.data.calls?.find(c => c.id === callId);
  
  const secrets = await getSecrets();
  const openaiKey = secrets.openaiKey;
  
  const prompt = `Generate a concise business summary for this sales call: ${conversationText.substring(0, 1500)}

Return JSON:
{
  "title": "Brief descriptive title for the call",
  "duration": "${call?.duration ? Math.round(call.duration / 60) + ' minutes' : 'Unknown'}",
  "participants": "${call?.parties?.map(p => p.name || p.emailAddress).join(', ') || 'Unknown'}",
  "keyPoints": ["3 most important discussion points"],
  "sentiment": "Positive|Negative|Neutral",
  "nextSteps": "Primary next action",
  "urgentActions": 0,
  "businessValue": "Potential business impact or value discussed"
}`;

  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4-turbo-preview',
    messages: [
      { role: 'system', content: 'You are a sales call summarizer. Return only valid JSON.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 600,
    temperature: 0.3,
    response_format: { type: "json_object" }
  }, {
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  return JSON.parse(response.data.choices[0].message.content);
}

async function analyzeSentiment(conversationText) {
  const secrets = await getSecrets();
  const openaiKey = secrets.openaiKey;
  
  const prompt = `Analyze the sentiment of this sales conversation: ${conversationText.substring(0, 2000)}

Return JSON:
{
  "overallSentiment": "Positive|Negative|Neutral",
  "confidence": 0.85,
  "customerSentiment": "Positive|Negative|Neutral",
  "salespersonSentiment": "Positive|Negative|Neutral",
  "keyEmotionalMoments": ["Moments where sentiment changed"],
  "concerns": ["Customer concerns expressed"],
  "enthusiasm": ["Signs of customer interest"]
}`;

  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4-turbo-preview',
    messages: [
      { role: 'system', content: 'You are a sentiment analysis expert. Return only valid JSON.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 500,
    temperature: 0.3,
    response_format: { type: "json_object" }
  }, {
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  return JSON.parse(response.data.choices[0].message.content);
}

async function processBatch(callIds, gongConfig) {
  // Get transcripts for the batch
  const transcripts = await getGongTranscripts(callIds, gongConfig);
  
  const results = [];
  
  // Process all calls in the batch concurrently
  const promises = transcripts.map(async (transcript) => {
    const conversationText = extractConversationText(transcript.transcript);
    
    if (!conversationText || conversationText.length < 100) {
      return {
        callId: transcript.callId,
        error: 'Insufficient transcript content'
      };
    }
    
    try {
      const analysis = await generateCallSummary(conversationText, transcript.callId, gongConfig);
      await storeAnalysis(transcript.callId, analysis, 'batch_summary');
      
      return {
        callId: transcript.callId,
        analysis: analysis,
        analysisType: 'batch_summary'
      };
    } catch (error) {
      return {
        callId: transcript.callId,
        error: 'Analysis failed',
        details: error.message
      };
    }
  });
  
  const batchResults = await Promise.all(promises);
  return batchResults;
}

async function storeAnalysis(callId, analysis, analysisType) {
  try {
    const doc = firestore.collection('call_analyses').doc(`${callId}_${analysisType}`);
    await doc.set({
      callId,
      analysisType,
      analysis,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    console.log(`Stored analysis for call ${callId}, type: ${analysisType}`);
  } catch (error) {
    console.error(`Failed to store analysis for call ${callId}:`, error);
    // Don't throw error - analysis can still be returned even if storage fails
  }
}

async function getSecrets() {
  const now = Date.now();
  
  if (now - lastSecretRefresh < CACHE_DURATION && Object.keys(secretsCache).length > 0) {
    return secretsCache;
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  
  const [accessKeyResponse] = await secretClient.accessSecretVersion({
    name: `projects/${projectId}/secrets/gong-access-key/versions/latest`,
  });
  
  const [secretKeyResponse] = await secretClient.accessSecretVersion({
    name: `projects/${projectId}/secrets/gong-secret-key/versions/latest`,
  });
  
  const [baseUrlResponse] = await secretClient.accessSecretVersion({
    name: `projects/${projectId}/secrets/gong-api-base-url/versions/latest`,
  });

  // Try to get OpenAI key (optional)
  let openaiKey = null;
  try {
    const [openaiResponse] = await secretClient.accessSecretVersion({
      name: `projects/${projectId}/secrets/openai-api-key/versions/latest`,
    });
    openaiKey = openaiResponse.payload.data.toString();
  } catch (error) {
    console.warn('OpenAI API key not found in Secret Manager. AI analysis features will be limited.');
  }

  secretsCache = {
    accessKey: accessKeyResponse.payload.data.toString(),
    secretKey: secretKeyResponse.payload.data.toString(),
    baseUrl: baseUrlResponse.payload.data.toString(),
    openaiKey
  };
  
  lastSecretRefresh = now;
  return secretsCache;
}

function createGongConfig(secrets) {
  const credentials = `${secrets.accessKey}:${secrets.secretKey}`;
  const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
  
  return {
    baseUrl: secrets.baseUrl,
    authHeader,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}