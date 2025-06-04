// functions/gong-api/index.js - Enhanced main router with AI analysis orchestration
const functions = require('@google-cloud/functions-framework');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const axios = require('axios');

// Initialize Secret Manager client
const secretClient = new SecretManagerServiceClient();

// Cache for secrets (refresh every hour)
let secretsCache = {};
let lastSecretRefresh = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Function endpoints (adjust these URLs to your actual Google Cloud Function URLs)
const FUNCTION_ENDPOINTS = {
  calls: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/callsHandler',
  transcript: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/transcriptHandler',
  aiAnalysis: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/aiAnalysisHandler',
  dailySummary: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/dailySummary',
  users: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/usersHandler'
};

/**
 * Main HTTP Cloud Function handler - Routes and orchestrates requests
 */
functions.http('gongApi', async (req, res) => {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    // Request validation
    if (!req.body) {
      return res.status(400).json({ 
        error: 'Request body is required',
        details: 'Expected JSON body with action or path parameter' 
      });
    }

    const { action, path, method = 'GET', params, body, dateRange, period } = req.body;

    console.log('Main router processing request:', JSON.stringify(req.body, null, 2));

    // Get secrets from Secret Manager
    const secrets = await getSecrets();
    let result;

    // Route based on action (your specific requirements)
    if (action) {
      result = await handleActionRequest(action, req.body, secrets);
    } 
    // Legacy path-based routing (maintain backward compatibility)
    else if (path) {
      result = await handlePathRequest(path, method, params, body, dateRange, period, secrets);
    }
    else {
      return res.status(400).json({ 
        error: 'Action or path parameter required',
        availableActions: [
          'analyze_daily_calls',
          'analyze_call_sentiment', 
          'get_daily_summary',
          'get_call_action_items',
          'get_call_landing_points',
          'get_call_hurdles',
          'detailed_call_analysis'
        ],
        examples: {
          dailyAnalysis: { action: 'analyze_daily_calls', period: 'yesterday' },
          callSentiment: { action: 'analyze_call_sentiment', period: 'today' },
          detailedAnalysis: { action: 'detailed_call_analysis', callId: 'your_call_id' }
        }
      });
    }

    console.log('Request completed successfully');
    res.status(200).json(result);

  } catch (error) {
    console.error('Main router error:', error);

    // Determine appropriate error status and message
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    let errorDetails = error.message;

    if (error.response) {
      statusCode = error.response.status;
      errorMessage = error.response.data?.message || 'API request failed';
      errorDetails = error.response.data?.details || error.response.statusText;
    } else if (error.code === 'ECONNABORTED') {
      statusCode = 408;
      errorMessage = 'Request timeout';
      errorDetails = 'The request timed out';
    } else if (error.message.includes('credentials')) {
      statusCode = 401;
      errorMessage = 'Authentication failed';
      errorDetails = 'Could not retrieve or use API credentials';
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: errorDetails,
      timestamp: new Date().toISOString(),
      requestId: req.get('x-cloud-trace-context') || 'unknown'
    });
  }
});

/**
 * Handle action-based requests (your specific requirements)
 */
async function handleActionRequest(action, requestData, secrets) {
  console.log(`Handling action: ${action}`);

  switch (action) {
    case 'analyze_daily_calls':
      return await analyzeDailyCalls(requestData.period || 'yesterday', secrets);
    
    case 'analyze_call_sentiment':
      return await analyzeCallSentiment(requestData.period || 'today', requestData.callIds, secrets);
    
    case 'get_daily_summary':
      return await getDailySummary(requestData.period || 'yesterday', secrets);
    
    case 'get_call_action_items':
      return await getCallActionItems(requestData.period || 'today', requestData.callIds, secrets);
    
    case 'get_call_landing_points':
      return await getCallLandingPoints(requestData.period || 'today', requestData.callIds, secrets);
    
    case 'get_call_hurdles':
      return await getCallHurdles(requestData.period || 'today', requestData.callIds, secrets);
    
    case 'detailed_call_analysis':
      if (!requestData.callId) {
        throw new Error('callId is required for detailed analysis');
      }
      return await detailedCallAnalysis(requestData.callId, secrets);
    
    default:
      throw new Error(`Unknown action: ${action}. Available actions: analyze_daily_calls, analyze_call_sentiment, get_daily_summary, get_call_action_items, get_call_landing_points, get_call_hurdles, detailed_call_analysis`);
  }
}

/**
 * Handle legacy path-based requests (maintain compatibility)
 */
async function handlePathRequest(path, method, params, body, dateRange, period, secrets) {
  const authHeader = createAuthHeader(secrets.accessKey, secrets.secretKey);
  const gongConfig = {
    baseUrl: secrets.baseUrl,
    authHeader,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };

  // Special handling for transcript requests
  if (path && (path.includes('/transcript') || path.includes('transcript'))) {
    const callIdMatch = path.match(/calls\/([^\/]+)\/transcript/) || path.match(/([a-f0-9]{24})/);
    if (!callIdMatch) {
      throw new Error('Could not extract call ID from path. Expected format: /calls/{callId}/transcript');
    }
    
    const callId = callIdMatch[1];
    return await callFunction(FUNCTION_ENDPOINTS.transcript, {
      callId: callId
    });
  } else {
    // Handle regular API requests
    let processedParams = { ...params };
    
    // Add date filtering if period is specified
    if (period) {
      const dateRangeObj = getDateRange(period);
      if (dateRangeObj) {
        processedParams.fromDateTime = dateRangeObj.fromDateTime;
        processedParams.toDateTime = dateRangeObj.toDateTime;
      }
    }
    
    // Override with explicit date range if provided
    if (dateRange) {
      if (dateRange.fromDateTime) {
        processedParams.fromDateTime = parseDate(dateRange.fromDateTime) || processedParams.fromDateTime;
      }
      if (dateRange.toDateTime) {
        processedParams.toDateTime = parseDate(dateRange.toDateTime) || processedParams.toDateTime;
      }
    }

    return await handleApiRequest(path, method, processedParams, body, gongConfig);
  }
}

/**
 * YOUR REQUIREMENTS: Analyze all calls from a specific day
 * Returns: sentiment, landing points, hurdles, action items for each call
 */
async function analyzeDailyCalls(period, secrets) {
  console.log(`Starting daily calls analysis for period: ${period}`);
  
  const dateRange = getDateRange(period);
  
  // Step 1: Get all calls for the period
  const callsResponse = await callFunction(FUNCTION_ENDPOINTS.calls, {
    method: 'GET',
    query: {
      fromDateTime: dateRange.fromDateTime,
      toDateTime: dateRange.toDateTime,
      limit: 100
    }
  });

  const calls = callsResponse.calls || [];
  console.log(`Found ${calls.length} calls for analysis`);

  if (calls.length === 0) {
    return {
      period,
      dateRange,
      totalCalls: 0,
      message: 'No calls found for the specified period',
      analyses: []
    };
  }

  // Step 2: Get transcripts for all calls
  const callIds = calls.map(call => call.id);
  const transcriptResponse = await callFunction(FUNCTION_ENDPOINTS.transcript, {
    callIds: callIds
  });

  const transcripts = transcriptResponse.callTranscripts || [];
  console.log(`Retrieved ${transcripts.length} transcripts`);

  // Step 3: Analyze each call with AI
  const analysisResponse = await callFunction(FUNCTION_ENDPOINTS.aiAnalysis, {
    callIds: callIds,
    analysisType: 'full'
  });

  const analyses = analysisResponse.results || [];

  // Step 4: Combine and structure the results for your requirements
  const detailedResults = calls.map(call => {
    const transcript = transcripts.find(t => t.callId === call.id);
    const analysis = analyses.find(a => a.callId === call.id);

    return {
      callId: call.id,
      title: call.title,
      date: call.started,
      duration: call.durationFormatted || formatDuration(call.duration),
      participants: call.participantNames || 'Unknown',
      
      // YOUR SPECIFIC REQUIREMENTS:
      sentiment: {
        overall: analysis?.analysis?.sentiment || 'neutral',
        confidence: analysis?.analysis?.confidence || 0,
        reasoning: analysis?.analysis?.reasoning || 'No analysis available'
      },
      
      landingPoint: {
        currentStage: analysis?.analysis?.landingPoint?.currentStage || 'Unknown',
        nextSteps: analysis?.analysis?.landingPoint?.nextSteps || 'No next steps identified',
        timeline: analysis?.analysis?.landingPoint?.timeline || 'No timeline discussed'
      },
      
      hurdles: analysis?.analysis?.landingPoint?.hurdles || 'No hurdles identified',
      
      actionItems: analysis?.analysis?.actionItems || [],
      
      keyInsights: {
        keyQuote: analysis?.analysis?.keyQuote || null,
        qualificationLevel: analysis?.analysis?.businessInsights?.qualificationLevel || 'Unknown',
        buyingSignals: analysis?.analysis?.businessInsights?.buyingSignals || [],
        concerns: analysis?.analysis?.businessInsights?.concerns || [],
        competitorMentions: analysis?.analysis?.businessInsights?.competitorMentions || []
      },
      
      hasTranscript: !!transcript,
      analysisSuccess: !analysis?.error
    };
  });

  // Step 5: Generate overall summary
  const successfulAnalyses = detailedResults.filter(r => r.analysisSuccess);
  const overallSentiment = calculateOverallSentiment(successfulAnalyses);
  const allActionItems = successfulAnalyses.flatMap(r => r.actionItems);
  const allHurdles = successfulAnalyses.map(r => r.hurdles).filter(h => h !== 'No hurdles identified');

  return {
    period,
    dateRange,
    summary: {
      totalCalls: calls.length,
      analyzedCalls: successfulAnalyses.length,
      overallSentiment,
      totalActionItems: allActionItems.length,
      totalHurdles: allHurdles.length,
      averageCallDuration: calls.reduce((sum, call) => sum + (call.duration || 0), 0) / calls.length,
      callsWithConcerns: successfulAnalyses.filter(r => r.keyInsights.concerns.length > 0).length,
      highQualificationCalls: successfulAnalyses.filter(r => r.keyInsights.qualificationLevel === 'High').length
    },
    calls: detailedResults,
    aggregatedInsights: {
      commonHurdles: getMostCommonHurdles(allHurdles),
      priorityActionItems: getPriorityActionItems(allActionItems),
      buyingSignalsSummary: aggregateBuyingSignals(successfulAnalyses),
      competitorMentions: aggregateCompetitorMentions(successfulAnalyses)
    },
    generatedAt: new Date().toISOString()
  };
}

/**
 * YOUR REQUIREMENT: Get sentiment analysis for calls in a period
 */
async function analyzeCallSentiment(period, callIds, secrets) {
  console.log(`Analyzing call sentiment for period: ${period}`);
  
  let targetCallIds = callIds;
  
  // If no specific call IDs provided, get all calls for the period
  if (!targetCallIds || targetCallIds.length === 0) {
    const dateRange = getDateRange(period);
    const callsResponse = await callFunction(FUNCTION_ENDPOINTS.calls, {
      method: 'GET',
      query: {
        fromDateTime: dateRange.fromDateTime,
        toDateTime: dateRange.toDateTime,
        limit: 100
      }
    });
    targetCallIds = (callsResponse.calls || []).map(call => call.id);
  }

  if (targetCallIds.length === 0) {
    return {
      period,
      message: 'No calls found for sentiment analysis',
      sentimentSummary: { positive: 0, neutral: 0, negative: 0 }
    };
  }

  // Get sentiment analysis
  const analysisResponse = await callFunction(FUNCTION_ENDPOINTS.aiAnalysis, {
    callIds: targetCallIds,
    analysisType: 'sentiment'
  });

  const sentimentResults = (analysisResponse.results || []).map(result => ({
    callId: result.callId,
    sentiment: result.analysis?.overallSentiment || 'neutral',
    confidence: result.analysis?.confidence || 0,
    customerSentiment: result.analysis?.customerSentiment || 'neutral',
    salespersonSentiment: result.analysis?.salespersonSentiment || 'neutral',
    concerns: result.analysis?.concerns || [],
    enthusiasm: result.analysis?.enthusiasm || []
  }));

  // Calculate sentiment distribution
  const sentimentDistribution = {
    positive: sentimentResults.filter(r => r.sentiment === 'positive').length,
    neutral: sentimentResults.filter(r => r.sentiment === 'neutral').length,
    negative: sentimentResults.filter(r => r.sentiment === 'negative').length
  };

  return {
    period,
    totalCallsAnalyzed: sentimentResults.length,
    sentimentDistribution,
    sentimentPercentages: {
      positive: Math.round((sentimentDistribution.positive / sentimentResults.length) * 100) || 0,
      neutral: Math.round((sentimentDistribution.neutral / sentimentResults.length) * 100) || 0,
      negative: Math.round((sentimentDistribution.negative / sentimentResults.length) * 100) || 0
    },
    callSentiments: sentimentResults,
    insights: {
      mostPositiveCalls: sentimentResults.filter(r => r.sentiment === 'positive' && r.confidence > 0.7),
      concerningCalls: sentimentResults.filter(r => r.sentiment === 'negative' && r.concerns.length > 0),
      averageConfidence: sentimentResults.reduce((sum, r) => sum + r.confidence, 0) / sentimentResults.length
    }
  };
}

/**
 * YOUR REQUIREMENT: Get daily summary of all calls
 */
async function getDailySummary(period, secrets) {
  console.log(`Generating daily summary for period: ${period}`);
  
  // Call the daily summary function
  const summaryResponse = await callFunction(FUNCTION_ENDPOINTS.dailySummary, {
    period: period
  });

  return summaryResponse;
}

/**
 * YOUR REQUIREMENT: Get action items from all calls in a day
 */
async function getCallActionItems(period, callIds, secrets) {
  console.log(`Extracting action items for period: ${period}`);
  
  const analysisResult = await analyzeDailyCalls(period, secrets);
  
  const allActionItems = analysisResult.calls.flatMap(call => 
    call.actionItems.map(item => ({
      ...item,
      callId: call.callId,
      callTitle: call.title,
      callDate: call.date
    }))
  );

  // Group by urgency
  const actionItemsByUrgency = {
    high: allActionItems.filter(item => item.urgency === 'High'),
    medium: allActionItems.filter(item => item.urgency === 'Medium'),
    low: allActionItems.filter(item => item.urgency === 'Low')
  };

  return {
    period,
    totalActionItems: allActionItems.length,
    actionItemsByUrgency: {
      high: actionItemsByUrgency.high.length,
      medium: actionItemsByUrgency.medium.length,
      low: actionItemsByUrgency.low.length
    },
    actionItems: allActionItems,
    prioritizedList: [
      ...actionItemsByUrgency.high,
      ...actionItemsByUrgency.medium,
      ...actionItemsByUrgency.low
    ],
    summary: {
      callsWithActionItems: analysisResult.calls.filter(call => call.actionItems.length > 0).length,
      averageActionsPerCall: allActionItems.length / analysisResult.calls.length,
      mostCommonOwners: getMostCommonActionOwners(allActionItems)
    }
  };
}

/**
 * YOUR REQUIREMENT: Get landing points (where deals stand) for all calls
 */
async function getCallLandingPoints(period, callIds, secrets) {
  console.log(`Analyzing call landing points for period: ${period}`);
  
  const analysisResult = await analyzeDailyCalls(period, secrets);
  
  const landingPointsSummary = analysisResult.calls.map(call => ({
    callId: call.callId,
    title: call.title,
    currentStage: call.landingPoint.currentStage,
    nextSteps: call.landingPoint.nextSteps,
    timeline: call.landingPoint.timeline,
    qualificationLevel: call.keyInsights.qualificationLevel
  }));

  // Analyze distribution by stage
  const stageDistribution = landingPointsSummary.reduce((acc, call) => {
    const stage = call.currentStage;
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, {});

  return {
    period,
    totalCalls: landingPointsSummary.length,
    stageDistribution,
    landingPoints: landingPointsSummary,
    insights: {
      dealsInDiscovery: landingPointsSummary.filter(call => call.currentStage === 'Discovery').length,
      dealsInDemo: landingPointsSummary.filter(call => call.currentStage === 'Demo').length,
      dealsInProposal: landingPointsSummary.filter(call => call.currentStage === 'Proposal').length,
      dealsInNegotiation: landingPointsSummary.filter(call => call.currentStage === 'Negotiation').length,
      dealsInClosing: landingPointsSummary.filter(call => call.currentStage === 'Closing').length,
      highQualificationDeals: landingPointsSummary.filter(call => call.qualificationLevel === 'High').length,
      callsWithTimeline: landingPointsSummary.filter(call => call.timeline !== 'No timeline discussed').length
    }
  };
}

/**
 * YOUR REQUIREMENT: Get hurdles to signing for all calls
 */
async function getCallHurdles(period, callIds, secrets) {
  console.log(`Analyzing call hurdles for period: ${period}`);
  
  const analysisResult = await analyzeDailyCalls(period, secrets);
  
  const hurdlesData = analysisResult.calls.map(call => ({
    callId: call.callId,
    title: call.title,
    hurdles: call.hurdles,
    concerns: call.keyInsights.concerns,
    qualificationLevel: call.keyInsights.qualificationLevel,
    currentStage: call.landingPoint.currentStage
  })).filter(call => call.hurdles !== 'No hurdles identified' || call.concerns.length > 0);

  // Extract all unique hurdles and concerns
  const allHurdles = hurdlesData.flatMap(call => 
    typeof call.hurdles === 'string' ? [call.hurdles] : call.hurdles
  );
  const allConcerns = hurdlesData.flatMap(call => call.concerns);

  return {
    period,
    totalCallsWithHurdles: hurdlesData.length,
    hurdlesBreakdown: hurdlesData,
    analysis: {
      mostCommonHurdles: getMostCommonItems(allHurdles),
      mostCommonConcerns: getMostCommonItems(allConcerns),
      hurdlesByStage: groupHurdlesByStage(hurdlesData),
      urgentHurdles: hurdlesData.filter(call => 
        call.currentStage === 'Negotiation' || call.currentStage === 'Closing'
      )
    },
    recommendations: generateHurdleRecommendations(allHurdles, allConcerns)
  };
}

/**
 * YOUR REQUIREMENT: Detailed analysis of a specific call
 */
async function detailedCallAnalysis(callId, secrets) {
  console.log(`Performing detailed analysis for call: ${callId}`);
  
  // Step 1: Get call details
  const callResponse = await callFunction(FUNCTION_ENDPOINTS.calls, {
    action: 'getCallDetails',
    callId: callId
  });

  // Step 2: Get transcript
  const transcriptResponse = await callFunction(FUNCTION_ENDPOINTS.transcript, {
    callId: callId
  });

  // Step 3: Get AI analysis
  const analysisResponse = await callFunction(FUNCTION_ENDPOINTS.aiAnalysis, {
    callIds: [callId],
    analysisType: 'full'
  });

  const callDetails = callResponse.call;
  const transcript = transcriptResponse.callTranscripts?.[0];
  const analysis = analysisResponse.results?.[0]?.analysis;

  return {
    callOverview: {
      id: callId,
      title: callDetails.title,
      date: callDetails.started,
      duration: callDetails.durationFormatted,
      participants: callDetails.participants
    },
    sentimentAnalysis: {
      overall: analysis?.sentiment || 'neutral',
      confidence: analysis?.confidence || 0,
      reasoning: analysis?.reasoning || 'No analysis available',
      customerSentiment: analysis?.customerSentiment || 'neutral',
      salespersonSentiment: analysis?.salespersonSentiment || 'neutral'
    },
    dealAnalysis: {
      currentStage: analysis?.landingPoint?.currentStage || 'Unknown',
      nextSteps: analysis?.landingPoint?.nextSteps || 'No next steps identified',
      hurdles: analysis?.landingPoint?.hurdles || 'No hurdles identified',
      timeline: analysis?.landingPoint?.timeline || 'No timeline discussed',
      qualificationLevel: analysis?.businessInsights?.qualificationLevel || 'Unknown'
    },
    actionItems: analysis?.actionItems || [],
    businessInsights: {
      keyQuote: analysis?.keyQuote || null,
      buyingSignals: analysis?.businessInsights?.buyingSignals || [],
      concerns: analysis?.businessInsights?.concerns || [],
      competitorMentions: analysis?.businessInsights?.competitorMentions || [],
      decisionMakers: analysis?.businessInsights?.decisionMakers || []
    },
    transcriptAnalysis: transcript ? {
      totalWords: transcript.analytics?.totalWords || 0,
      speakingTime: transcript.analytics?.speakerStats || {},
      keyMoments: transcript.analytics?.keyMoments || [],
      topicFlow: transcript.analytics?.topicFlow || []
    } : null,
    recommendations: generateCallRecommendations(analysis, transcript)
  };
}

// Helper Functions

async function getSecrets() {
  const now = Date.now();
  
  if (now - lastSecretRefresh < CACHE_DURATION && Object.keys(secretsCache).length > 0) {
    return secretsCache;
  }

  try {
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
    console.log('Secrets refreshed from Secret Manager');
    
    return secretsCache;
  } catch (error) {
    console.error('Error retrieving secrets:', error);
    throw new Error('Failed to retrieve API credentials');
  }
}

function createAuthHeader(accessKey, secretKey) {
  const credentials = `${accessKey}:${secretKey}`;
  const encoded = Buffer.from(credentials).toString('base64');
  return `Basic ${encoded}`;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  
  return date.toISOString();
}

function getDateRange(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  switch (period?.toLowerCase()) {
    case 'today':
      return {
        fromDateTime: today.toISOString(),
        toDateTime: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
      };
      
    case 'yesterday':
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      return {
        fromDateTime: yesterday.toISOString(),
        toDateTime: today.toISOString()
      };
      
    case 'this week':
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      return {
        fromDateTime: startOfWeek.toISOString(),
        toDateTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
      };
      
    case 'last week':
      const lastWeekStart = new Date(today);
      lastWeekStart.setDate(today.getDate() - today.getDay() - 7);
      const lastWeekEnd = new Date(lastWeekStart);
      lastWeekEnd.setDate(lastWeekStart.getDate() + 7);
      return {
        fromDateTime: lastWeekStart.toISOString(),
        toDateTime: lastWeekEnd.toISOString()
      };
      
    default:
      // Default to last 30 days
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      return {
        fromDateTime: thirtyDaysAgo.toISOString(),
        toDateTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
      };
  }
}

async function callFunction(endpoint, data) {
  try {
    const response = await axios.post(endpoint, data, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 second timeout
    });
    
    return response.data;
  } catch (error) {
    console.error(`Error calling function ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
}

async function handleApiRequest(path, method, queryParams, body, gongConfig) {
  const url = `${gongConfig.baseUrl}${path}`;
  
  const config = {
    method: method.toLowerCase(),
    url,
    headers: gongConfig.headers,
    timeout: 30000
  };

  // Add query parameters
  if (queryParams && Object.keys(queryParams).length > 0) {
    config.params = queryParams;
  }

  // Add request body for POST/PUT requests
  if (body && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT')) {
    config.data = body;
  }

  console.log('API request:', JSON.stringify({ url, method, params: queryParams, data: body }, null, 2));

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error('API request failed:', error.response?.data || error.message);
    throw error;
  }
}

function formatDuration(duration) {
  if (!duration) return '0:00';
  
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

function calculateOverallSentiment(analyses) {
  if (analyses.length === 0) return 'neutral';
  
  const sentimentScores = { 'positive': 1, 'neutral': 0, 'negative': -1 };
  const average = analyses.reduce((sum, analysis) => {
    return sum + (sentimentScores[analysis.sentiment.overall] || 0);
  }, 0) / analyses.length;
  
  if (average > 0.3) return 'positive';
  if (average < -0.3) return 'negative';
  return 'neutral';
}

function getMostCommonHurdles(hurdles) {
  const hurdleCount = {};
  hurdles.forEach(hurdle => {
    if (hurdle && hurdle !== 'No hurdles identified') {
      hurdleCount[hurdle] = (hurdleCount[hurdle] || 0) + 1;
    }
  });
  
  return Object.entries(hurdleCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([hurdle, count]) => ({ hurdle, count }));
}

function getPriorityActionItems(actionItems) {
  return actionItems
    .filter(item => item.urgency === 'High')
    .slice(0, 10)
    .map(item => ({
      task: item.task,
      owner: item.owner,
      context: item.context,
      urgency: item.urgency
    }));
}

function aggregateBuyingSignals(analyses) {
  const allSignals = analyses.flatMap(analysis => 
    analysis.keyInsights.buyingSignals || []
  );
  
  return getMostCommonItems(allSignals).slice(0, 5);
}

function aggregateCompetitorMentions(analyses) {
  const allCompetitors = analyses.flatMap(analysis => 
    analysis.keyInsights.competitorMentions || []
  );
  
  return getMostCommonItems(allCompetitors).slice(0, 5);
}

function getMostCommonActionOwners(actionItems) {
  const ownerCount = {};
  actionItems.forEach(item => {
    if (item.owner) {
      ownerCount[item.owner] = (ownerCount[item.owner] || 0) + 1;
    }
  });
  
  return Object.entries(ownerCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([owner, count]) => ({ owner, count }));
}

function getMostCommonItems(items) {
  const itemCount = {};
  items.forEach(item => {
    if (item) {
      itemCount[item] = (itemCount[item] || 0) + 1;
    }
  });
  
  return Object.entries(itemCount)
    .sort(([,a], [,b]) => b - a)
    .map(([item, count]) => ({ item, count }));
}

function groupHurdlesByStage(hurdlesData) {
  const stageGroups = {};
  
  hurdlesData.forEach(call => {
    const stage = call.currentStage;
    if (!stageGroups[stage]) {
      stageGroups[stage] = [];
    }
    stageGroups[stage].push({
      callId: call.callId,
      title: call.title,
      hurdles: call.hurdles,
      concerns: call.concerns
    });
  });
  
  return stageGroups;
}

function generateHurdleRecommendations(hurdles, concerns) {
  const recommendations = [];
  
  // Common hurdle patterns and recommendations
  const hurdlePatterns = {
    'budget': 'Consider offering flexible pricing options or demonstrating ROI',
    'timeline': 'Provide implementation timeline clarity and support options',
    'decision maker': 'Schedule meeting with key stakeholders and decision makers',
    'feature': 'Provide detailed feature demonstration and technical documentation',
    'integration': 'Offer technical consultation and integration support',
    'security': 'Provide security documentation and compliance certifications'
  };
  
  const allHurdleText = [...hurdles, ...concerns].join(' ').toLowerCase();
  
  Object.entries(hurdlePatterns).forEach(([pattern, recommendation]) => {
    if (allHurdleText.includes(pattern)) {
      recommendations.push({
        issue: pattern,
        recommendation: recommendation,
        priority: hurdles.filter(h => h.toLowerCase().includes(pattern)).length > 1 ? 'High' : 'Medium'
      });
    }
  });
  
  return recommendations;
}

function generateCallRecommendations(analysis, transcript) {
  const recommendations = [];
  
  if (!analysis) {
    return ['No analysis available - ensure call has transcript and AI analysis completed'];
  }
  
  // Sentiment-based recommendations
  if (analysis.sentiment === 'negative') {
    recommendations.push({
      type: 'follow-up',
      priority: 'High',
      action: 'Schedule immediate follow-up to address concerns raised in this call',
      reasoning: 'Negative sentiment detected'
    });
  }
  
  // Stage-based recommendations
  const stage = analysis.landingPoint?.currentStage;
  if (stage === 'Discovery') {
    recommendations.push({
      type: 'next-step',
      priority: 'Medium',
      action: 'Schedule product demonstration based on discovered needs',
      reasoning: 'Call is in discovery stage'
    });
  } else if (stage === 'Demo') {
    recommendations.push({
      type: 'next-step',
      priority: 'Medium',
      action: 'Send detailed proposal with pricing and implementation timeline',
      reasoning: 'Demo completed, move to proposal stage'
    });
  }
  
  // Action items-based recommendations
  if (analysis.actionItems && analysis.actionItems.length > 0) {
    const highPriorityActions = analysis.actionItems.filter(item => item.urgency === 'High');
    if (highPriorityActions.length > 0) {
      recommendations.push({
        type: 'action-required',
        priority: 'High',
        action: `Complete ${highPriorityActions.length} high-priority action items from this call`,
        reasoning: 'High-priority commitments made during call'
      });
    }
  }
  
  // Competitor mentions
  if (analysis.businessInsights?.competitorMentions?.length > 0) {
    recommendations.push({
      type: 'competitive',
      priority: 'Medium',
      action: 'Prepare competitive differentiation materials for next interaction',
      reasoning: `Competitors mentioned: ${analysis.businessInsights.competitorMentions.join(', ')}`
    });
  }
  
  // Buying signals
  if (analysis.businessInsights?.buyingSignals?.length > 2) {
    recommendations.push({
      type: 'opportunity',
      priority: 'High',
      action: 'Accelerate sales process - strong buying signals detected',
      reasoning: `Multiple buying signals: ${analysis.businessInsights.buyingSignals.join(', ')}`
    });
  }
  
  return recommendations.length > 0 ? recommendations : [
    {
      type: 'standard',
      priority: 'Medium',
      action: 'Schedule follow-up meeting to maintain momentum',
      reasoning: 'Standard follow-up recommendation'
    }
  ];
}

// Health check endpoint
functions.http('health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.GAE_VERSION || '2.0.0',
    features: [
      'gong-api-routing',
      'call-analysis',
      'daily-summaries', 
      'sentiment-analysis',
      'action-items-extraction',
      'hurdles-identification',
      'landing-points-analysis',
      'detailed-call-analysis'
    ],
    endpoints: Object.keys(FUNCTION_ENDPOINTS)
  });
});