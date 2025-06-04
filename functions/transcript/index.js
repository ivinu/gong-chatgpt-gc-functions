// functions/transcript/index.js - Enhanced transcript processing function
const functions = require('@google-cloud/functions-framework');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const axios = require('axios');

// Initialize Secret Manager client
const secretClient = new SecretManagerServiceClient();

// Cache for secrets
let secretsCache = {};
let lastSecretRefresh = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Transcript Handler - Enhanced version of your Vercel transcript function
 */
functions.http('transcriptHandler', async (req, res) => {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    console.log('Transcript request with body:', req.body);

    // Get secrets from Secret Manager
    const secrets = await getSecrets();
    const gongConfig = createGongConfig(secrets);

    // Extract call IDs from request body (matching your Vercel implementation)
    const { callIds, callId } = req.body;
    
    // Normalize to array of call IDs
    let targetCallIds = [];
    if (callIds && Array.isArray(callIds)) {
      targetCallIds = callIds;
    } else if (callId) {
      targetCallIds = [callId];
    } else if (callIds && typeof callIds === 'string') {
      targetCallIds = [callIds];
    }
    
    if (targetCallIds.length === 0) {
      return res.status(400).json({ 
        error: 'Call IDs required',
        message: 'Please provide callIds array or single callId',
        example: { 
          callIds: ["8319037588481130420"],
          callId: "8319037588481130420" 
        }
      });
    }
    
    console.log('Processing transcript request for call IDs:', targetCallIds);
    
    // Build Gong transcript request (matching your exact format)
    const transcriptRequest = {
      filter: {
        callIds: targetCallIds,
        fromDateTime: "2023-01-01T00:00:00Z",
        toDateTime: "2025-12-31T23:59:59Z"
      }
    };
    
    console.log('Making transcript request to Gong:', JSON.stringify(transcriptRequest, null, 2));
    
    // Make request to Gong API
    const response = await axios.post(`${gongConfig.baseUrl}/calls/transcript`, transcriptRequest, {
      headers: gongConfig.headers,
      timeout: 30000
    });
    
    const data = response.data;
    console.log(`Retrieved transcripts for ${data.callTranscripts ? data.callTranscripts.length : 0} calls`);
    
    // Process and enhance transcript response (matching your implementation)
    const enhancedResponse = {
      callTranscripts: data.callTranscripts ? data.callTranscripts.map(transcript => ({
        callId: transcript.callId,
        transcript: transcript.transcript ? processTranscriptEntries(transcript.transcript) : [],
        // Add enhanced analytics
        analytics: analyzeTranscriptContent(transcript.transcript),
        conversationText: extractConversationText(transcript.transcript)
      })) : [],
      
      transcriptSummary: {
        totalTranscripts: data.callTranscripts ? data.callTranscripts.length : 0,
        requestedCallIds: targetCallIds,
        processedAt: new Date().toISOString(),
        enhancedFeatures: {
          speakerAnalysis: true,
          timelineMapping: true,
          topicExtraction: true,
          conversationFlow: true
        }
      }
    };
    
    console.log('Returning enhanced transcript response');
    res.status(200).json(enhancedResponse);
    
  } catch (error) {
    console.error('Transcript function error:', error);
    
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    
    if (error.response) {
      statusCode = error.response.status;
      errorMessage = error.response.data?.message || 'Gong transcript request failed';
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Process transcript entries and extract actual sentences (from your Vercel code)
 */
function processTranscriptEntries(transcriptArray) {
  if (!Array.isArray(transcriptArray)) return [];
  
  const processedEntries = [];
  const speakerMap = new Map(); // Track speaker names
  
  for (const entry of transcriptArray) {
    // Check if entry has sentences array (this is where the actual content is)
    if (entry.sentences && Array.isArray(entry.sentences)) {
      // Process each sentence in the entry
      for (const sentence of entry.sentences) {
        processedEntries.push({
          speakerId: entry.speakerId,
          speakerName: getSpeakerName(entry.speakerId, speakerMap),
          sentence: sentence.text || 'No text available',
          startTime: sentence.start ? sentence.start / 1000 : 0, // Convert ms to seconds
          endTime: sentence.end ? sentence.end / 1000 : 0,       // Convert ms to seconds
          timestamp: formatTimestamp(sentence.start ? sentence.start / 1000 : 0),
          topic: entry.topic || null,
          // Enhanced fields
          duration: sentence.end && sentence.start ? (sentence.end - sentence.start) / 1000 : 0,
          wordCount: sentence.text ? sentence.text.split(' ').length : 0,
          sentiment: analyzeSentence(sentence.text)
        });
      }
    } else {
      // Fallback for entries without sentences array
      processedEntries.push({
        speakerId: entry.speakerId,
        speakerName: getSpeakerName(entry.speakerId, speakerMap),
        sentence: entry.sentence || entry.text || 'No content available',
        startTime: entry.startTime || 0,
        endTime: entry.endTime || 0,
        timestamp: formatTimestamp(entry.startTime || 0),
        topic: entry.topic || null,
        duration: 0,
        wordCount: 0,
        sentiment: 'neutral'
      });
    }
  }
  
  return processedEntries;
}

/**
 * Extract conversation text from transcript (from your ai-analysis code)
 */
function extractConversationText(transcriptArray) {
  if (!Array.isArray(transcriptArray)) return '';
  
  const conversation = [];
  const speakerMap = new Map();
  
  for (const entry of transcriptArray) {
    if (entry.sentences && Array.isArray(entry.sentences)) {
      const speakerId = entry.speakerId;
      let speakerName = `Speaker${speakerMap.size + 1}`;
      
      if (!speakerMap.has(speakerId)) {
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

/**
 * Analyze transcript content for insights
 */
function analyzeTranscriptContent(transcriptArray) {
  if (!Array.isArray(transcriptArray)) return {};
  
  const analysis = {
    speakerStats: {},
    totalDuration: 0,
    totalWords: 0,
    sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
    topicFlow: [],
    interactionMetrics: {
      questionCount: 0,
      exclamationCount: 0,
      speakerSwitches: 0
    }
  };
  
  let lastSpeaker = null;
  
  for (const entry of transcriptArray) {
    if (entry.sentences && Array.isArray(entry.sentences)) {
      const speakerId = entry.speakerId;
      
      // Track speaker switches
      if (lastSpeaker && lastSpeaker !== speakerId) {
        analysis.interactionMetrics.speakerSwitches++;
      }
      lastSpeaker = speakerId;
      
      // Initialize speaker stats
      if (!analysis.speakerStats[speakerId]) {
        analysis.speakerStats[speakerId] = {
          totalTime: 0,
          wordCount: 0,
          sentenceCount: 0,
          avgWordsPerSentence: 0
        };
      }
      
      for (const sentence of entry.sentences) {
        const text = sentence.text || '';
        const duration = sentence.end && sentence.start ? (sentence.end - sentence.start) / 1000 : 0;
        const words = text.split(' ').length;
        
        // Update totals
        analysis.totalDuration += duration;
        analysis.totalWords += words;
        
        // Update speaker stats
        analysis.speakerStats[speakerId].totalTime += duration;
        analysis.speakerStats[speakerId].wordCount += words;
        analysis.speakerStats[speakerId].sentenceCount++;
        
        // Analyze sentiment
        const sentiment = analyzeSentence(text);
        analysis.sentimentDistribution[sentiment]++;
        
        // Count interactions
        if (text.includes('?')) analysis.interactionMetrics.questionCount++;
        if (text.includes('!')) analysis.interactionMetrics.exclamationCount++;
        
        // Topic tracking
        if (entry.topic) {
          const existingTopic = analysis.topicFlow.find(t => t.topic === entry.topic);
          if (existingTopic) {
            existingTopic.duration += duration;
            existingTopic.mentions++;
          } else {
            analysis.topicFlow.push({
              topic: entry.topic,
              startTime: sentence.start ? sentence.start / 1000 : 0,
              duration: duration,
              mentions: 1
            });
          }
        }
      }
    }
  }
  
  // Calculate averages
  Object.keys(analysis.speakerStats).forEach(speakerId => {
    const stats = analysis.speakerStats[speakerId];
    stats.avgWordsPerSentence = stats.sentenceCount > 0 ? stats.wordCount / stats.sentenceCount : 0;
    stats.talkTimePercentage = analysis.totalDuration > 0 ? (stats.totalTime / analysis.totalDuration) * 100 : 0;
  });
  
  return analysis;
}

// Helper Functions

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

  secretsCache = {
    accessKey: accessKeyResponse.payload.data.toString(),
    secretKey: secretKeyResponse.payload.data.toString(),
    baseUrl: baseUrlResponse.payload.data.toString(),
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

// Helper function to generate readable speaker names (from your code)
function getSpeakerName(speakerId, speakerMap) {
  if (!speakerMap.has(speakerId)) {
    const speakerNumber = speakerMap.size + 1;
    speakerMap.set(speakerId, `Speaker ${speakerNumber}`);
  }
  return speakerMap.get(speakerId);
}

// Helper function to format timestamps (from your code)
function formatTimestamp(seconds) {
  if (!seconds && seconds !== 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Simple sentiment analysis for individual sentences
function analyzeSentence(text) {
  if (!text) return 'neutral';
  
  const positiveWords = ['great', 'excellent', 'good', 'love', 'perfect', 'amazing', 'fantastic', 'wonderful'];
  const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'concern', 'problem', 'issue'];
  
  const lowerText = text.toLowerCase();
  
  const positiveCount = positiveWords.filter(word => lowerText.includes(word)).length;
  const negativeCount = negativeWords.filter(word => lowerText.includes(word)).length;
  
  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}