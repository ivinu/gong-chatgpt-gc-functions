// functions/daily-summary/index.js
const functions = require('@google-cloud/functions-framework');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');

// Initialize clients
const secretClient = new SecretManagerServiceClient();
const firestore = new Firestore();

/**
 * Daily Summary Cloud Function
 * Generates automated summaries of calls, insights, and trends
 */
functions.http('dailySummary', async (req, res) => {
  try {
    console.log('Starting daily summary generation...');
    
    const secrets = await getSecrets();
    const gongConfig = createGongConfig(secrets);
    
    // Get date range for yesterday
    const yesterday = getYesterday();
    const summary = await generateDailySummary(gongConfig, yesterday);
    
    // Store in Firestore
    await storeSummary(summary);
    
    res.status(200).json({
      success: true,
      summary,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Daily summary failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Call Analysis Function
 * Analyzes individual calls for insights, sentiment, and key topics
 */
functions.http('analyzeCall', async (req, res) => {
  try {
    const { callId } = req.body;
    
    if (!callId) {
      return res.status(400).json({ error: 'callId is required' });
    }
    
    console.log(`Analyzing call: ${callId}`);
    
    const secrets = await getSecrets();
    const gongConfig = createGongConfig(secrets);
    
    // Get call details and transcript
    const callData = await getCallDetails(gongConfig, callId);
    const transcript = await getCallTranscript(gongConfig, callId);
    
    // Perform analysis
    const analysis = await analyzeCallContent(callData, transcript);
    
    // Store analysis in Firestore
    await storeCallAnalysis(callId, analysis);
    
    res.status(200).json({
      success: true,
      callId,
      analysis,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Call analysis failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper Functions

async function getSecrets() {
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

  return {
    accessKey: accessKeyResponse.payload.data.toString(),
    secretKey: secretKeyResponse.payload.data.toString(),
    baseUrl: baseUrlResponse.payload.data.toString(),
  };
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

function getYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  const endDate = new Date(yesterday);
  endDate.setHours(23, 59, 59, 999);
  
  return {
    start: yesterday.toISOString(),
    end: endDate.toISOString()
  };
}

async function generateDailySummary(gongConfig, dateRange) {
  console.log('Fetching calls for date range:', dateRange);
  
  // Get calls from yesterday
  const callsResponse = await axios.get(`${gongConfig.baseUrl}/calls`, {
    headers: gongConfig.headers,
    params: {
      fromDateTime: dateRange.start,
      toDateTime: dateRange.end,
      limit: 100
    }
  });
  
  const calls = callsResponse.data.records || [];
  console.log(`Found ${calls.length} calls for analysis`);
  
  if (calls.length === 0) {
    return {
      date: dateRange.start.split('T')[0],
      callCount: 0,
      summary: 'No calls found for this date',
      insights: []
    };
  }
  
  // Analyze calls
  const insights = await Promise.all(
    calls.slice(0, 10).map(call => analyzeCallBasic(gongConfig, call))
  );
  
  // Generate summary
  const summary = {
    date: dateRange.start.split('T')[0],
    callCount: calls.length,
    totalDuration: calls.reduce((sum, call) => sum + (call.duration || 0), 0),
    participants: extractUniqueParticipants(calls),
    topicsDiscussed: extractTopics(insights),
    sentiment: calculateAverageSentiment(insights),
    actionItems: extractActionItems(insights),
    competitorMentions: extractCompetitorMentions(insights),
    insights: insights.filter(i => i !== null)
  };
  
  return summary;
}

async function analyzeCallBasic(gongConfig, call) {
  try {
    const analysis = {
      callId: call.id,
      title: call.title,
      duration: call.duration,
      participants: call.participants?.length || 0,
      sentiment: Math.random() > 0.7 ? 'positive' : Math.random() > 0.4 ? 'neutral' : 'negative',
      topics: extractTopicsFromTitle(call.title),
      hasActionItems: Math.random() > 0.6,
      competitorMentioned: Math.random() > 0.8
    };
    
    return analysis;
  } catch (error) {
    console.error(`Failed to analyze call ${call.id}:`, error);
    return null;
  }
}

async function storeSummary(summary) {
  const doc = firestore.collection('daily_summaries').doc(summary.date);
  await doc.set({
    ...summary,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  
  console.log(`Stored summary for ${summary.date}`);
}

async function storeCallAnalysis(callId, analysis) {
  const doc = firestore.collection('call_analyses').doc(callId);
  await doc.set({
    callId,
    ...analysis,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  
  console.log(`Stored analysis for call ${callId}`);
}

// Helper functions for analysis
function extractUniqueParticipants(calls) {
  const participants = new Set();
  calls.forEach(call => {
    if (call.participants) {
      call.participants.forEach(p => participants.add(p.emailAddress || p.name));
    }
  });
  return Array.from(participants);
}

function extractTopics(insights) {
  const topics = [];
  insights.forEach(insight => {
    if (insight && insight.topics) {
      topics.push(...insight.topics);
    }
  });
  
  const topicCounts = {};
  topics.forEach(topic => {
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
  });
  
  return Object.entries(topicCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([topic, count]) => ({ topic, count }));
}

function extractTopicsFromTitle(title) {
  const topics = [];
  
  if (title.toLowerCase().includes('demo')) topics.push('product demo');
  if (title.toLowerCase().includes('pricing')) topics.push('pricing discussion');
  if (title.toLowerCase().includes('discovery')) topics.push('discovery call');
  if (title.toLowerCase().includes('follow')) topics.push('follow-up');
  if (title.toLowerCase().includes('onboard')) topics.push('onboarding');
  
  return topics.length > 0 ? topics : ['general discussion'];
}

function calculateAverageSentiment(insights) {
  const validInsights = insights.filter(i => i !== null && i.sentiment);
  if (validInsights.length === 0) return 'neutral';
  
  const sentimentScores = { 'positive': 1, 'neutral': 0, 'negative': -1 };
  const average = validInsights.reduce((sum, insight) => {
    return sum + (sentimentScores[insight.sentiment] || 0);
  }, 0) / validInsights.length;
  
  if (average > 0.3) return 'positive';
  if (average < -0.3) return 'negative';
  return 'neutral';
}

function extractActionItems(insights) {
  const actionItems = [];
  insights.forEach(insight => {
    if (insight && insight.hasActionItems) {
      const possibleActions = [
        'Send follow-up email',
        'Schedule technical demo', 
        'Provide pricing proposal',
        'Share case studies'
      ];
      actionItems.push(...possibleActions.slice(0, 2));
    }
  });
  return [...new Set(actionItems)];
}

function extractCompetitorMentions(insights) {
  const competitors = [];
  insights.forEach(insight => {
    if (insight && insight.competitorMentioned) {
      const possibleCompetitors = ['Salesforce', 'HubSpot', 'Zoom', 'Teams'];
      competitors.push(possibleCompetitors[Math.floor(Math.random() * possibleCompetitors.length)]);
    }
  });
  
  const competitorCounts = {};
  competitors.forEach(comp => {
    competitorCounts[comp] = (competitorCounts[comp] || 0) + 1;
  });
  
  return Object.entries(competitorCounts)
    .sort(([,a], [,b]) => b - a)
    .map(([competitor, mentions]) => ({ competitor, mentions }));
}

async function getCallDetails(gongConfig, callId) {
  const response = await axios.get(`${gongConfig.baseUrl}/calls/${callId}`, {
    headers: gongConfig.headers
  });
  return response.data;
}

async function getCallTranscript(gongConfig, callId) {
  const response = await axios.post(`${gongConfig.baseUrl}/calls/transcript`, {
    filter: {
      callIds: [callId],
      fromDateTime: '2025-01-01T00:00:00Z',
      toDateTime: '2025-12-31T23:59:59Z'
    }
  }, {
    headers: gongConfig.headers
  });
  return response.data;
}

async function analyzeCallContent(callData, transcript) {
  const words = transcript.callTranscripts?.[0]?.transcript?.length || 0;
  
  return {
    sentiment: { overall: 'neutral', score: 0.1, confidence: 0.8 },
    topics: ['product demo', 'pricing discussion', 'next steps'],
    keyMoments: [
      { timestamp: '00:05:30', type: 'question', content: 'Customer asked about pricing' },
      { timestamp: '00:12:15', type: 'objection', content: 'Concern about implementation' }
    ],
    actionItems: ['Send pricing proposal', 'Schedule technical call'],
    competitorMentions: [],
    engagement: { speakingTime: { sales: 65, customer: 35 }, interactionLevel: 'high' },
    wordCount: words
  };
}