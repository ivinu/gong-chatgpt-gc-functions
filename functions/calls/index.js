// functions/calls/index.js - Complete enhanced calls management function
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
 * Calls Handler - Specialized function for Gong calls management
 */
functions.http('callsHandler', async (req, res) => {
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
    console.log('Calls function - Processing request:', req.method, req.url);

    // Get secrets from Secret Manager
    const secrets = await getSecrets();
    const gongConfig = createGongConfig(secrets);

    let result;

    // Handle different call-related endpoints
    switch (req.method) {
      case 'GET':
        result = await handleGetCalls(req, gongConfig);
        break;
      case 'POST':
        result = await handleCallOperation(req, gongConfig);
        break;
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('Calls function - Request completed successfully');
    res.status(200).json(result);

  } catch (error) {
    console.error('Calls function error:', error);
    
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    
    if (error.response) {
      statusCode = error.response.status;
      errorMessage = error.response.data?.message || 'API request failed';
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Handle GET requests for calls (enhanced version of your Vercel calls.js)
 */
async function handleGetCalls(req, gongConfig) {
  const { 
    fromDateTime, 
    toDateTime, 
    userId, 
    limit = 50, 
    period = 'week',
    status,
    minDuration,
    maxDuration 
  } = req.query;

  console.log('Fetching calls with params:', { fromDateTime, toDateTime, userId, limit, period });

  // Calculate date range (matching your Vercel implementation)
  const dateRange = getDateRange(period, fromDateTime, toDateTime);
  
  const params = {
    limit: parseInt(limit),
    fromDateTime: dateRange.fromDateTime,
    toDateTime: dateRange.toDateTime
  };

  // Add filters
  if (userId) {
    params.participantIds = userId;
  }

  if (status) {
    params.status = status;
  }

  const response = await axios.get(`${gongConfig.baseUrl}/calls`, {
    headers: gongConfig.headers,
    params
  });

  let calls = response.data.records || response.data.calls || [];

  // Apply duration filters
  if (minDuration) {
    calls = calls.filter(call => (call.duration || 0) >= parseInt(minDuration));
  }
  
  if (maxDuration) {
    calls = calls.filter(call => (call.duration || 0) <= parseInt(maxDuration));
  }

  // Enhanced call data processing (matching your enhanceCallData function)
  const processedCalls = calls.map(call => ({
    ...call,
    // Original Vercel enhancements
    gongUrl: `https://us-22394.app.gong.io/call?id=${call.id}`,
    formattedDate: new Date(call.started).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    }),
    formattedTime: new Date(call.started).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    }),
    durationFormatted: call.duration ? `${Math.round(call.duration / 60)} minutes` : 'Unknown',
    hasRecording: !!(call.media && call.media.length > 0),
    participantNames: call.parties ? call.parties.map(p => 
      p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.emailAddress || 'Unknown'
    ).filter(name => name && name !== 'Unknown').join(', ') : 'Unknown',
    queryDate: call.started ? new Date(call.started).toISOString().split('T')[0] : null,
    
    // New enhanced fields
    participants: call.parties?.map(p => ({
      id: p.id,
      name: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim(),
      email: p.emailAddress,
      role: p.role
    })) || [],
    participantsCount: call.parties?.length || 0,
    direction: call.direction,
    outcome: call.outcome,
    sentiment: analyzeSentiment(call.title), // Basic sentiment from title
    tags: extractTags(call.title),
    // Computed fields
    isDemo: call.title?.toLowerCase().includes('demo'),
    isDiscovery: call.title?.toLowerCase().includes('discovery'),
    isFollowUp: call.title?.toLowerCase().includes('follow'),
    callType: determineCallType(call)
  }));

  // Calculate summary statistics (matching your Vercel format)
  const stats = {
    totalCalls: processedCalls.length,
    totalDuration: processedCalls.reduce((sum, call) => sum + (call.duration || 0), 0),
    averageDuration: processedCalls.length > 0 
      ? processedCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / processedCalls.length 
      : 0,
    hasRecordings: processedCalls.filter(call => call.hasRecording).length,
    callTypes: getCallTypeDistribution(processedCalls),
    participantsStats: getParticipantsStats(processedCalls)
  };

  // Enhanced response (matching your Vercel structure + improvements)
  return {
    calls: processedCalls,
    callsSummary: {
      totalCalls: processedCalls.length,
      hasRecordings: stats.hasRecordings,
      processedAt: new Date().toISOString(),
      dateRange: {
        from: dateRange.fromDateTime,
        to: dateRange.toDateTime
      }
    },
    stats,
    filters: { fromDateTime, toDateTime, userId, period, status },
    records: response.data.records // Include original Gong response
  };
}

/**
 * Handle POST requests for call operations
 */
async function handleCallOperation(req, gongConfig) {
  const { action, callId, data } = req.body;

  console.log('Call operation:', { action, callId });

  switch (action) {
    case 'getCallDetails':
      return await getCallDetails(callId, gongConfig);
    
    case 'getCallTranscript':
      return await getCallTranscript(callId, gongConfig);
    
    case 'analyzeCall':
      return await analyzeCall(callId, gongConfig);
    
    case 'searchCalls':
      return await searchCalls(data, gongConfig);
    
    case 'getCallStats':
      return await getCallStats(data, gongConfig);
    
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Get detailed information for a specific call
 */
async function getCallDetails(callId, gongConfig) {
  if (!callId) {
    throw new Error('Call ID is required');
  }

  const response = await axios.get(`${gongConfig.baseUrl}/calls/${callId}`, {
    headers: gongConfig.headers
  });

  const call = response.data;

  // Get additional call metadata
  const enrichedCall = {
    ...call,
    durationFormatted: formatDuration(call.duration),
    sentiment: analyzeSentiment(call.title),
    tags: extractTags(call.title),
    callType: determineCallType(call),
    insights: {
      isDemo: call.title?.toLowerCase().includes('demo'),
      isDiscovery: call.title?.toLowerCase().includes('discovery'),
      isFollowUp: call.title?.toLowerCase().includes('follow'),
      hasPricing: call.title?.toLowerCase().includes('pricing'),
      hasObjections: call.title?.toLowerCase().includes('objection'),
    },
    participants: call.parties?.map(p => ({
      ...p,
      fullName: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
      isInternal: p.role === 'sales' || p.role === 'internal',
      isProspect: p.role === 'prospect' || p.role === 'customer'
    })) || []
  };

  return {
    call: enrichedCall,
    metadata: {
      retrievedAt: new Date().toISOString(),
      hasRecording: !!(call.media && call.media.length > 0),
      canGetTranscript: true
    }
  };
}

/**
 * Get call transcript with enhanced processing
 */
async function getCallTranscript(callId, gongConfig) {
  if (!callId) {
    throw new Error('Call ID is required');
  }

  // Get call details first
  const callDetails = await getCallDetails(callId, gongConfig);
  
  // Get transcript
  const transcriptResponse = await axios.post(`${gongConfig.baseUrl}/calls/transcript`, {
    filter: {
      callIds: [callId],
      fromDateTime: '2025-01-01T00:00:00Z',
      toDateTime: '2025-12-31T23:59:59Z'
    }
  }, {
    headers: gongConfig.headers
  });

  const transcriptData = transcriptResponse.data;
  const transcript = transcriptData.callTranscripts?.[0];

  if (!transcript) {
    throw new Error('Transcript not found for this call');
  }

  // Process transcript entries
  const processedEntries = transcript.transcript?.map(entry => ({
    ...entry,
    speakerName: getSpeakerName(entry.speakerId, callDetails.call.participants),
    speakerRole: getSpeakerRole(entry.speakerId, callDetails.call.participants),
    timestamp: formatTimestamp(entry.start),
    duration: entry.end - entry.start,
    wordCount: entry.text?.split(' ').length || 0
  })) || [];

  // Calculate speaking time analysis
  const speakingAnalysis = calculateSpeakingTime(processedEntries);
  
  // Extract key moments
  const keyMoments = extractKeyMoments(processedEntries);

  return {
    callId,
    callTitle: callDetails.call.title,
    transcript: {
      entries: processedEntries,
      totalEntries: processedEntries.length,
      totalWords: processedEntries.reduce((sum, entry) => sum + entry.wordCount, 0),
      duration: callDetails.call.duration
    },
    analysis: {
      speakingTime: speakingAnalysis,
      keyMoments,
      topics: extractTranscriptTopics(processedEntries),
      sentiment: analyzeTranscriptSentiment(processedEntries),
      actionItems: extractActionItems(processedEntries)
    },
    metadata: {
      retrievedAt: new Date().toISOString(),
      callDate: callDetails.call.started
    }
  };
}

/**
 * Analyze call with AI insights
 */
async function analyzeCall(callId, gongConfig) {
  // Get both call details and transcript
  const [callDetails, transcriptData] = await Promise.all([
    getCallDetails(callId, gongConfig),
    getCallTranscript(callId, gongConfig).catch(() => null) // Don't fail if transcript unavailable
  ]);

  const call = callDetails.call;
  
  // Perform comprehensive analysis
  const analysis = {
    callOverview: {
      id: callId,
      title: call.title,
      duration: call.duration,
      participants: call.participants.length,
      callType: call.callType,
      sentiment: call.sentiment
    },
    participantAnalysis: {
      internal: call.participants.filter(p => p.isInternal).length,
      external: call.participants.filter(p => p.isProspect).length,
      speakingTime: transcriptData?.analysis.speakingTime || null
    },
    contentAnalysis: {
      topics: transcriptData?.analysis.topics || extractTags(call.title),
      keyMoments: transcriptData?.analysis.keyMoments || [],
      actionItems: transcriptData?.analysis.actionItems || [],
      sentiment: transcriptData?.analysis.sentiment || call.sentiment
    },
    businessInsights: {
      isQualified: analyzeQualification(call, transcriptData),
      nextSteps: extractNextSteps(call, transcriptData),
      concerns: extractConcerns(call, transcriptData),
      opportunities: extractOpportunities(call, transcriptData)
    },
    scores: {
      engagement: calculateEngagementScore(call, transcriptData),
      qualification: calculateQualificationScore(call, transcriptData),
      nextStepClarity: calculateNextStepScore(call, transcriptData)
    }
  };

  return analysis;
}

/**
 * Search calls with advanced criteria
 */
async function searchCalls(searchData, gongConfig) {
  const { 
    query, 
    filters = {}, 
    dateRange,
    limit = 50,
    sortBy = 'started',
    sortOrder = 'desc'
  } = searchData;

  const params = { 
    limit,
    ...getDateRange(dateRange?.period, dateRange?.fromDate, dateRange?.toDate)
  };

  // Apply filters
  if (filters.participantIds) {
    params.participantIds = filters.participantIds;
  }

  if (filters.direction) {
    params.direction = filters.direction;
  }

  const response = await axios.get(`${gongConfig.baseUrl}/calls`, {
    headers: gongConfig.headers,
    params
  });

  let calls = response.data.records || [];

  // Apply text search
  if (query) {
    const searchTerm = query.toLowerCase();
    calls = calls.filter(call => 
      call.title?.toLowerCase().includes(searchTerm) ||
      call.parties?.some(p => 
        p.firstName?.toLowerCase().includes(searchTerm) ||
        p.lastName?.toLowerCase().includes(searchTerm) ||
        p.emailAddress?.toLowerCase().includes(searchTerm)
      )
    );
  }

  // Apply additional filters
  if (filters.minDuration) {
    calls = calls.filter(call => (call.duration || 0) >= filters.minDuration);
  }

  if (filters.hasRecording !== undefined) {
    calls = calls.filter(call => !!(call.media && call.media.length > 0) === filters.hasRecording);
  }

  // Sort results
  calls.sort((a, b) => {
    let aValue = a[sortBy];
    let bValue = b[sortBy];
    
    if (sortBy === 'started') {
      aValue = new Date(aValue);
      bValue = new Date(bValue);
    }
    
    if (sortOrder === 'desc') {
      return bValue > aValue ? 1 : -1;
    } else {
      return aValue > bValue ? 1 : -1;
    }
  });

  const processedCalls = calls.map(call => ({
    id: call.id,
    title: call.title,
    started: call.started,
    duration: call.duration,
    durationFormatted: formatDuration(call.duration),
    participants: call.parties?.length || 0,
    callType: determineCallType(call),
    sentiment: analyzeSentiment(call.title),
    hasRecording: !!(call.media && call.media.length > 0)
  }));

  return {
    calls: processedCalls,
    searchQuery: query,
    filters,
    totalFound: processedCalls.length,
    sortBy,
    sortOrder
  };
}

/**
 * Get call statistics and analytics
 */
async function getCallStats(data, gongConfig) {
  const { dateRange, groupBy = 'day', participantIds } = data;
  
  const params = {
    limit: 1000,
    ...getDateRange(dateRange?.period, dateRange?.fromDate, dateRange?.toDate)
  };

  if (participantIds) {
    params.participantIds = participantIds;
  }

  const response = await axios.get(`${gongConfig.baseUrl}/calls`, {
    headers: gongConfig.headers,
    params
  });

  const calls = response.data.records || [];

  // Calculate various statistics
  const stats = {
    overview: {
      totalCalls: calls.length,
      totalDuration: calls.reduce((sum, call) => sum + (call.duration || 0), 0),
      averageDuration: calls.length > 0 
        ? calls.reduce((sum, call) => sum + (call.duration || 0), 0) / calls.length 
        : 0,
      uniqueParticipants: getUniqueParticipants(calls)
    },
    trends: {
      callsByPeriod: groupCallsByPeriod(calls, groupBy),
      durationTrends: getDurationTrends(calls, groupBy),
      participantTrends: getParticipantTrends(calls, groupBy)
    },
    insights: {
      topParticipants: getTopParticipants(calls),
      callTypeDistribution: getCallTypeDistribution(calls),
      timeDistribution: getTimeDistribution(calls),
      sentimentDistribution: getSentimentDistribution(calls)
    }
  };

  return stats;
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

function getDateRange(period, fromDate, toDate) {
  if (fromDate && toDate) {
    return {
      fromDateTime: new Date(fromDate).toISOString(),
      toDateTime: new Date(toDate).toISOString()
    };
  }

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
    case 'week':
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      return {
        fromDateTime: weekStart.toISOString(),
        toDateTime: new Date().toISOString()
      };
    case 'month':
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      return {
        fromDateTime: monthStart.toISOString(),
        toDateTime: new Date().toISOString()
      };
    default:
      // Default to last 30 days (matching your Vercel implementation)
      const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      return {
        fromDateTime: thirtyDaysAgo.toISOString(),
        toDateTime: now.toISOString()
      };
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

function analyzeSentiment(title) {
  if (!title) return 'neutral';
  
  const positive = ['great', 'excellent', 'good', 'positive', 'successful', 'interested'];
  const negative = ['concern', 'issue', 'problem', 'objection', 'decline', 'cancel'];
  
  const titleLower = title.toLowerCase();
  
  if (positive.some(word => titleLower.includes(word))) return 'positive';
  if (negative.some(word => titleLower.includes(word))) return 'negative';
  
  return 'neutral';
}

function extractTags(title) {
  if (!title) return [];
  
  const tags = [];
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes('demo')) tags.push('demo');
  if (titleLower.includes('discovery')) tags.push('discovery');
  if (titleLower.includes('follow')) tags.push('follow-up');
  if (titleLower.includes('pricing')) tags.push('pricing');
  if (titleLower.includes('onboard')) tags.push('onboarding');
  if (titleLower.includes('check')) tags.push('check-in');
  
  return tags;
}

function determineCallType(call) {
  const title = call.title?.toLowerCase() || '';
  
  if (title.includes('demo')) return 'demo';
  if (title.includes('discovery')) return 'discovery';
  if (title.includes('follow')) return 'follow-up';
  if (title.includes('onboard')) return 'onboarding';
  if (title.includes('check')) return 'check-in';
  if (title.includes('close') || title.includes('contract')) return 'closing';
  
  return 'general';
}

function getCallTypeDistribution(calls) {
  const types = {};
  calls.forEach(call => {
    const type = determineCallType(call);
    types[type] = (types[type] || 0) + 1;
  });
  return types;
}

function getParticipantsStats(calls) {
  const stats = {
    totalUnique: 0,
    averagePerCall: 0,
    distribution: {}
  };
  
  const uniqueParticipants = new Set();
  let totalParticipants = 0;
  
  calls.forEach(call => {
    const count = call.participantsCount || 0;
    totalParticipants += count;
    stats.distribution[count] = (stats.distribution[count] || 0) + 1;
    
    if (call.participants) {
      call.participants.forEach(p => {
        if (p.email) uniqueParticipants.add(p.email);
      });
    }
  });
  
  stats.totalUnique = uniqueParticipants.size;
  stats.averagePerCall = calls.length > 0 ? totalParticipants / calls.length : 0;
  
  return stats;
}

function getSpeakerName(speakerId, participants) {
  const participant = participants?.find(p => p.id === speakerId);
  return participant ? `${participant.firstName} ${participant.lastName}`.trim() : `Speaker ${speakerId}`;
}

function getSpeakerRole(speakerId, participants) {
  const participant = participants?.find(p => p.id === speakerId);
  return participant?.role || 'unknown';
}

function formatTimestamp(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function calculateSpeakingTime(entries) {
  const speakers = {};
  let totalTime = 0;
  
  entries.forEach(entry => {
    const duration = entry.duration || 0;
    const speaker = entry.speakerName;
    
    speakers[speaker] = (speakers[speaker] || 0) + duration;
    totalTime += duration;
  });
  
  // Convert to percentages
  const percentages = {};
  Object.keys(speakers).forEach(speaker => {
    percentages[speaker] = totalTime > 0 ? (speakers[speaker] / totalTime) * 100 : 0;
  });
  
  return {
    absolute: speakers,
    percentages,
    totalTime
  };
}

function extractKeyMoments(entries) {
  const keyMoments = [];
  
  entries.forEach((entry, index) => {
    const text = entry.text?.toLowerCase() || '';
    
    // Detect questions
    if (text.includes('?')) {
      keyMoments.push({
        timestamp: entry.timestamp,
        type: 'question',
        speaker: entry.speakerName,
        content: entry.text.substring(0, 100) + '...'
      });
    }
    
    // Detect objections
    if (text.includes('concern') || text.includes('worry') || text.includes('but')) {
      keyMoments.push({
        timestamp: entry.timestamp,
        type: 'objection',
        speaker: entry.speakerName,
        content: entry.text.substring(0, 100) + '...'
      });
    }
    
    // Detect action items
    if (text.includes('will send') || text.includes('will follow') || text.includes('next step')) {
      keyMoments.push({
        timestamp: entry.timestamp,
        type: 'action_item',
        speaker: entry.speakerName,
        content: entry.text.substring(0, 100) + '...'
      });
    }
  });
  
  return keyMoments.slice(0, 10); // Limit to top 10
}

function extractTranscriptTopics(entries) {
  const topics = [];
  const topicKeywords = {
    'pricing': ['price', 'cost', 'budget', 'expensive', 'cheap'],
    'features': ['feature', 'functionality', 'capability', 'tool'],
    'integration': ['integrate', 'api', 'connect', 'sync'],
    'timeline': ['when', 'timeline', 'deadline', 'launch'],
    'competition': ['competitor', 'alternative', 'compare', 'versus']
  };
  
  const fullText = entries.map(e => e.text || '').join(' ').toLowerCase();
  
  Object.keys(topicKeywords).forEach(topic => {
    const keywords = topicKeywords[topic];
    const mentions = keywords.filter(keyword => fullText.includes(keyword)).length;
    
    if (mentions > 0) {
      topics.push({ topic, mentions });
    }
  });
  
  return topics.sort((a, b) => b.mentions - a.mentions);
}

function analyzeTranscriptSentiment(entries) {
  const positiveWords = ['great', 'excellent', 'perfect', 'love', 'amazing', 'fantastic'];
  const negativeWords = ['concern', 'worry', 'problem', 'issue', 'difficult', 'expensive'];
  
  let positiveScore = 0;
  let negativeScore = 0;
  
  entries.forEach(entry => {
    const text = entry.text?.toLowerCase() || '';
    positiveWords.forEach(word => {
      if (text.includes(word)) positiveScore++;
    });
    negativeWords.forEach(word => {
      if (text.includes(word)) negativeScore++;
    });
  });
  
  const totalScore = positiveScore + negativeScore;
  if (totalScore === 0) return { overall: 'neutral', score: 0 };
  
  const sentiment = positiveScore > negativeScore ? 'positive' : 
                   negativeScore > positiveScore ? 'negative' : 'neutral';
  
  return {
    overall: sentiment,
    score: (positiveScore - negativeScore) / totalScore,
    positiveCount: positiveScore,
    negativeCount: negativeScore
  };
}

function extractActionItems(entries) {
  const actionItems = [];
  
  entries.forEach(entry => {
    const text = entry.text || '';
    const patterns = [
      /will send/i,
      /will follow up/i,
      /will get back/i,
      /next step/i,
      /action item/i,
      /to do/i
    ];
    
    patterns.forEach(pattern => {
      if (pattern.test(text)) {
        actionItems.push({
          text: text.substring(0, 150) + '...',
          speaker: entry.speakerName,
          timestamp: entry.timestamp
        });
      }
    });
  });
  
  return actionItems.slice(0, 5); // Limit to 5 action items
}

// Additional helper functions for analysis
function analyzeQualification(call, transcriptData) {
  let score = 0;
  
  // Check for qualifying questions in transcript
  if (transcriptData) {
    const qualifyingPhrases = ['budget', 'timeline', 'decision maker', 'authority'];
    const fullText = transcriptData.transcript.entries.map(e => e.text || '').join(' ').toLowerCase();
    
    qualifyingPhrases.forEach(phrase => {
      if (fullText.includes(phrase)) score += 25;
    });
  }
  
  // Check call type
  if (call.callType === 'discovery') score += 20;
  if (call.callType === 'demo') score += 15;
  
  return Math.min(score, 100);
}

function extractNextSteps(call, transcriptData) {
  const nextSteps = [];
  
  if (transcriptData) {
    transcriptData.analysis.actionItems.forEach(item => {
      nextSteps.push(item.text);
    });
  }
  
  // Add default next steps based on call type
  if (call.callType === 'discovery') {
    nextSteps.push('Schedule product demo');
  }
  
  return nextSteps;
}

function extractConcerns(call, transcriptData) {
  const concerns = [];
  
  if (transcriptData) {
    transcriptData.analysis.keyMoments
      .filter(moment => moment.type === 'objection')
      .forEach(objection => {
        concerns.push(objection.content);
      });
  }
  
  return concerns;
}

function extractOpportunities(call, transcriptData) {
  const opportunities = [];
  
  if (transcriptData) {
    const topics = transcriptData.analysis.topics;
    
    topics.forEach(topic => {
      if (topic.topic === 'features' && topic.mentions > 2) {
        opportunities.push('High interest in product features');
      }
      if (topic.topic === 'pricing' && topic.mentions > 1) {
        opportunities.push('Pricing discussion initiated');
      }
    });
  }
  
  return opportunities;
}

function calculateEngagementScore(call, transcriptData) {
  let score = 50; // Base score
  
  if (transcriptData) {
    // More balanced speaking time = higher engagement
    const speakingPercentages = Object.values(transcriptData.analysis.speakingTime.percentages);
    const balance = 1 - Math.abs(speakingPercentages[0] - speakingPercentages[1]) / 100;
    score += balance * 30;
    
    // More questions = higher engagement
    const questionCount = transcriptData.analysis.keyMoments.filter(m => m.type === 'question').length;
    score += Math.min(questionCount * 5, 20);
  }
  
  return Math.min(Math.max(score, 0), 100);
}

function calculateQualificationScore(call, transcriptData) {
  return analyzeQualification(call, transcriptData);
}

function calculateNextStepScore(call, transcriptData) {
  let score = 0;
  
  const nextSteps = extractNextSteps(call, transcriptData);
  
  if (nextSteps.length > 0) score += 50;
  if (nextSteps.length > 2) score += 30;
  
  // Specific next steps get bonus points
  const specificActions = ['demo', 'proposal', 'contract', 'meeting'];
  const hasSpecific = nextSteps.some(step => 
    specificActions.some(action => step.toLowerCase().includes(action))
  );
  
  if (hasSpecific) score += 20;
  
  return Math.min(score, 100);
}

function getUniqueParticipants(calls) {
  const participants = new Set();
  calls.forEach(call => {
    if (call.parties) {
      call.parties.forEach(p => {
        if (p.emailAddress) participants.add(p.emailAddress);
      });
    }
  });
  return participants.size;
}

function groupCallsByPeriod(calls, groupBy) {
  const groups = {};
  
  calls.forEach(call => {
    if (!call.started) return;
    
    const date = new Date(call.started);
    let key;
    
    switch (groupBy) {
      case 'hour':
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:00`;
        break;
      case 'day':
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
        break;
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = `${weekStart.getFullYear()}-${weekStart.getMonth() + 1}-${weekStart.getDate()}`;
        break;
      case 'month':
        key = `${date.getFullYear()}-${date.getMonth() + 1}`;
        break;
      default:
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }
    
    groups[key] = (groups[key] || 0) + 1;
  });
  
  return groups;
}

function getDurationTrends(calls, groupBy) {
  const groups = {};
  
  calls.forEach(call => {
    if (!call.started) return;
    
    const date = new Date(call.started);
    let key;
    
    switch (groupBy) {
      case 'day':
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
        break;
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = `${weekStart.getFullYear()}-${weekStart.getMonth() + 1}-${weekStart.getDate()}`;
        break;
      default:
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }
    
    if (!groups[key]) {
      groups[key] = { totalDuration: 0, callCount: 0 };
    }
    
    groups[key].totalDuration += call.duration || 0;
    groups[key].callCount += 1;
  });
  
  // Calculate averages
  Object.keys(groups).forEach(key => {
    groups[key].averageDuration = groups[key].callCount > 0 
      ? groups[key].totalDuration / groups[key].callCount 
      : 0;
  });
  
  return groups;
}

function getParticipantTrends(calls, groupBy) {
  const groups = {};
  
  calls.forEach(call => {
    if (!call.started) return;
    
    const date = new Date(call.started);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    
    if (!groups[key]) {
      groups[key] = { totalParticipants: 0, callCount: 0 };
    }
    
    groups[key].totalParticipants += call.parties?.length || 0;
    groups[key].callCount += 1;
  });
  
  // Calculate averages
  Object.keys(groups).forEach(key => {
    groups[key].averageParticipants = groups[key].callCount > 0 
      ? groups[key].totalParticipants / groups[key].callCount 
      : 0;
  });
  
  return groups;
}

function getTopParticipants(calls) {
  const participants = {};
  
  calls.forEach(call => {
    if (call.parties) {
      call.parties.forEach(p => {
        const key = p.emailAddress || `${p.firstName} ${p.lastName}`;
        if (!participants[key]) {
          participants[key] = {
            name: `${p.firstName} ${p.lastName}`.trim(),
            email: p.emailAddress,
            callCount: 0,
            totalDuration: 0
          };
        }
        
        participants[key].callCount += 1;
        participants[key].totalDuration += call.duration || 0;
      });
    }
  });
  
  return Object.values(participants)
    .sort((a, b) => b.callCount - a.callCount)
    .slice(0, 10);
}

function getTimeDistribution(calls) {
  const hours = Array(24).fill(0);
  
  calls.forEach(call => {
    if (call.started) {
      const hour = new Date(call.started).getHours();
      hours[hour]++;
    }
  });
  
  return hours.map((count, hour) => ({ hour, count }));
}

function getSentimentDistribution(calls) {
  const sentiments = { positive: 0, neutral: 0, negative: 0 };
  
  calls.forEach(call => {
    const sentiment = analyzeSentiment(call.title);
    sentiments[sentiment]++;
  });
  
  return sentiments;
}