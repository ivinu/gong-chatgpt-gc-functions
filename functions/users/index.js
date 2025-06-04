// functions/users/index.js - Complete enhanced users management function
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
 * Users Handler - Enhanced version of your Vercel users.js function
 */
functions.http('usersHandler', async (req, res) => {
  // CORS headers (matching your Vercel implementation)
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    console.log('Users function - Processing request:', req.method, req.url);

    // Get secrets from Secret Manager
    const secrets = await getSecrets();
    const gongConfig = createGongConfig(secrets);

    let result;

    // Handle different user-related endpoints
    switch (req.method) {
      case 'GET':
        result = await handleGetUsers(req, gongConfig);
        break;
      case 'POST':
        result = await handleUserOperation(req, gongConfig);
        break;
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('Users function - Request completed successfully');
    res.status(200).json(result);

  } catch (error) {
    console.error('Users function error:', error);
    
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    
    if (error.response) {
      statusCode = error.response.status;
      errorMessage = error.response.data?.message || 'Gong users request failed';
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Handle GET requests for users (enhanced version of your Vercel users.js)
 */
async function handleGetUsers(req, gongConfig) {
  const { workspace, active, email, limit = 100 } = req.query;

  console.log('Users request received with params:', { workspace, active, email, limit });

  const params = {
    limit: parseInt(limit)
  };

  // Add filters if provided
  if (active !== undefined) {
    params.active = active === 'true';
  }

  if (email) {
    params.emailAddress = email;
  }

  console.log('Making request to Gong API');

  // Make request to Gong API (matching your Vercel implementation)
  const response = await axios.get(`${gongConfig.baseUrl}/users`, {
    headers: gongConfig.headers,
    params
  });

  const data = response.data;
  console.log(`Retrieved ${data.users ? data.users.length : 0} users from Gong`);

  const users = data.users || data.records || [];

  // Enhanced user data processing
  const processedUsers = users.map(user => ({
    // Original user data
    ...user,
    
    // Enhanced computed fields
    id: user.id,
    emailAddress: user.emailAddress,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.emailAddress || 'Unknown',
    active: user.active !== false, // Default to true if not specified
    created: user.created,
    settings: user.settings,
    
    // Additional computed fields
    isManager: user.managerIds && user.managerIds.length > 0,
    lastActivity: user.lastActivity || null,
    timezone: user.settings?.timezone || 'UTC',
    role: user.settings?.role || 'user',
    department: user.settings?.department || 'Unknown',
    
    // Activity indicators
    isActiveUser: user.active !== false && user.lastActivity,
    displayName: user.firstName && user.lastName 
      ? `${user.firstName} ${user.lastName}` 
      : user.emailAddress || 'Unknown User'
  }));

  // Enhanced response (matching your Vercel structure + improvements)
  const enhancedResponse = {
    // Original Vercel structure
    users: processedUsers,
    usersSummary: {
      totalUsers: processedUsers.length,
      activeUsers: processedUsers.filter(user => user.active !== false).length,
      processedAt: new Date().toISOString()
    },
    records: data.records, // Include original Gong response
    
    // Enhanced analytics
    analytics: {
      userDistribution: {
        active: processedUsers.filter(u => u.active === true).length,
        inactive: processedUsers.filter(u => u.active === false).length,
        withManagers: processedUsers.filter(u => u.isManager).length,
        departments: getDepartmentDistribution(processedUsers),
        timezones: getTimezoneDistribution(processedUsers)
      },
      filters: { workspace, active, email },
      metadata: {
        requestTime: new Date().toISOString(),
        totalRequested: parseInt(limit),
        totalReturned: processedUsers.length
      }
    }
  };

  console.log('Returning enhanced users response');
  return enhancedResponse;
}

/**
 * Handle POST requests for user operations
 */
async function handleUserOperation(req, gongConfig) {
  const { action, userId, data } = req.body;

  console.log('User operation:', { action, userId });

  switch (action) {
    case 'getUserDetails':
      return await getUserDetails(userId, gongConfig);
    
    case 'getUserStats':
      return await getUserStats(userId, gongConfig);
    
    case 'searchUsers':
      return await searchUsers(data, gongConfig);
    
    case 'getUserActivity':
      return await getUserActivity(userId, data, gongConfig);
    
    case 'getUserCalls':
      return await getUserCalls(userId, data, gongConfig);
    
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Get detailed information for a specific user
 */
async function getUserDetails(userId, gongConfig) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  // Get user details
  const userResponse = await axios.get(`${gongConfig.baseUrl}/users`, {
    headers: gongConfig.headers
  });

  const user = userResponse.data.users?.find(u => u.id === userId);
  
  if (!user) {
    throw new Error('User not found');
  }

  // Get user's recent calls
  const callsResponse = await axios.get(`${gongConfig.baseUrl}/calls`, {
    headers: gongConfig.headers,
    params: {
      participantIds: userId,
      limit: 10,
      fromDateTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // Last 30 days
    }
  });

  const recentCalls = callsResponse.data.records || callsResponse.data.calls || [];

  return {
    user: {
      ...user,
      fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.emailAddress,
      displayName: user.firstName && user.lastName 
        ? `${user.firstName} ${user.lastName}` 
        : user.emailAddress || 'Unknown User'
    },
    recentCalls: recentCalls.map(call => ({
      id: call.id,
      title: call.title,
      started: call.started,
      duration: call.duration,
      durationFormatted: formatDuration(call.duration),
      participantsCount: call.parties?.length || 0,
      callType: determineCallType(call.title)
    })),
    stats: {
      totalRecentCalls: recentCalls.length,
      totalCallTime: recentCalls.reduce((sum, call) => sum + (call.duration || 0), 0),
      averageCallDuration: recentCalls.length > 0 
        ? recentCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / recentCalls.length 
        : 0,
      mostCommonCallType: getMostCommonCallType(recentCalls)
    },
    metadata: {
      retrievedAt: new Date().toISOString(),
      callsDateRange: '30 days'
    }
  };
}

/**
 * Get user statistics and analytics
 */
async function getUserStats(userId, gongConfig) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Last 30 days

  // Get user's calls for the period
  const callsResponse = await axios.get(`${gongConfig.baseUrl}/calls`, {
    headers: gongConfig.headers,
    params: {
      participantIds: userId,
      fromDateTime: startDate.toISOString(),
      toDateTime: endDate.toISOString(),
      limit: 1000
    }
  });

  const calls = callsResponse.data.records || callsResponse.data.calls || [];

  // Calculate comprehensive statistics
  const stats = {
    period: {
      from: startDate.toISOString().split('T')[0],
      to: endDate.toISOString().split('T')[0],
      days: 30
    },
    callMetrics: {
      totalCalls: calls.length,
      totalDuration: calls.reduce((sum, call) => sum + (call.duration || 0), 0),
      averageDuration: calls.length > 0 
        ? calls.reduce((sum, call) => sum + (call.duration || 0), 0) / calls.length 
        : 0,
      longestCall: Math.max(...calls.map(call => call.duration || 0), 0),
      shortestCall: calls.length > 0 ? Math.min(...calls.map(call => call.duration || 0)) : 0,
      callsPerWeek: Math.round(calls.length / 4.3) // Approximate weeks in 30 days
    },
    activity: {
      callsPerDay: Math.round(calls.length / 30),
      mostActiveDay: getMostActiveDay(calls),
      callDistribution: getCallDistribution(calls),
      peakHours: getPeakHours(calls)
    },
    collaboration: {
      uniqueParticipants: getUniqueParticipants(calls),
      averageParticipantsPerCall: calls.length > 0
        ? calls.reduce((sum, call) => sum + (call.parties?.length || 0), 0) / calls.length
        : 0,
      internalVsExternal: getInternalExternalRatio(calls),
      frequentCollaborators: getFrequentCollaborators(calls, userId)
    },
    callTypes: {
      distribution: getCallTypeDistribution(calls),
      trends: getCallTypeTrends(calls)
    },
    performance: {
      engagementScore: calculateUserEngagementScore(calls),
      consistencyScore: calculateConsistencyScore(calls),
      productivityScore: calculateProductivityScore(calls)
    }
  };

  return stats;
}

/**
 * Search users with advanced criteria
 */
async function searchUsers(searchData, gongConfig) {
  const { query, filters = {}, limit = 50 } = searchData;

  const params = { limit };

  // Add search filters
  if (filters.active !== undefined) {
    params.active = filters.active;
  }

  if (filters.role) {
    params.role = filters.role;
  }

  const response = await axios.get(`${gongConfig.baseUrl}/users`, {
    headers: gongConfig.headers,
    params
  });

  let users = response.data.users || response.data.records || [];

  // Apply text search if query provided
  if (query) {
    const searchTerm = query.toLowerCase();
    users = users.filter(user => 
      user.firstName?.toLowerCase().includes(searchTerm) ||
      user.lastName?.toLowerCase().includes(searchTerm) ||
      user.emailAddress?.toLowerCase().includes(searchTerm)
    );
  }

  // Apply additional filters
  if (filters.department) {
    users = users.filter(user => 
      user.settings?.department?.toLowerCase().includes(filters.department.toLowerCase())
    );
  }

  if (filters.hasRecentActivity) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    users = users.filter(user => 
      user.lastActivity && new Date(user.lastActivity) > thirtyDaysAgo
    );
  }

  return {
    users: users.map(user => ({
      id: user.id,
      emailAddress: user.emailAddress,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.emailAddress,
      active: user.active !== false,
      role: user.settings?.role || 'user',
      department: user.settings?.department || 'Unknown',
      lastActivity: user.lastActivity,
      displayName: user.firstName && user.lastName 
        ? `${user.firstName} ${user.lastName}` 
        : user.emailAddress || 'Unknown User'
    })),
    searchQuery: query,
    filters,
    totalFound: users.length,
    appliedFilters: Object.keys(filters).length
  };
}

/**
 * Get user activity timeline
 */
async function getUserActivity(userId, options, gongConfig) {
  const { days = 30, includeDetails = false } = options || {};
  
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  // Get user's calls for the period
  const callsResponse = await axios.get(`${gongConfig.baseUrl}/calls`, {
    headers: gongConfig.headers,
    params: {
      participantIds: userId,
      fromDateTime: startDate.toISOString(),
      toDateTime: endDate.toISOString(),
      limit: 1000
    }
  });

  const calls = callsResponse.data.records || callsResponse.data.calls || [];

  // Group calls by day
  const activityByDay = {};
  calls.forEach(call => {
    const date = new Date(call.started).toISOString().split('T')[0];
    if (!activityByDay[date]) {
      activityByDay[date] = {
        date,
        callCount: 0,
        totalDuration: 0,
        calls: []
      };
    }
    
    activityByDay[date].callCount++;
    activityByDay[date].totalDuration += call.duration || 0;
    
    if (includeDetails) {
      activityByDay[date].calls.push({
        id: call.id,
        title: call.title,
        started: call.started,
        duration: call.duration,
        participants: call.parties?.length || 0
      });
    }
  });

  // Convert to array and sort by date
  const timeline = Object.values(activityByDay).sort((a, b) => 
    new Date(a.date) - new Date(b.date)
  );

  return {
    userId,
    period: {
      from: startDate.toISOString().split('T')[0],
      to: endDate.toISOString().split('T')[0],
      days
    },
    timeline,
    summary: {
      totalDays: timeline.length,
      activeDays: timeline.filter(day => day.callCount > 0).length,
      totalCalls: calls.length,
      averageCallsPerActiveDay: timeline.length > 0 
        ? calls.length / timeline.filter(day => day.callCount > 0).length 
        : 0
    }
  };
}

/**
 * Get calls for a specific user with filters
 */
async function getUserCalls(userId, options, gongConfig) {
  const { 
    limit = 50, 
    fromDate, 
    toDate, 
    callType, 
    minDuration,
    sortBy = 'started',
    sortOrder = 'desc'
  } = options || {};

  const params = {
    participantIds: userId,
    limit: parseInt(limit)
  };

  // Add date filters
  if (fromDate) params.fromDateTime = new Date(fromDate).toISOString();
  if (toDate) params.toDateTime = new Date(toDate).toISOString();
  
  // Default to last 30 days if no dates provided
  if (!fromDate && !toDate) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    params.fromDateTime = thirtyDaysAgo.toISOString();
    params.toDateTime = now.toISOString();
  }

  const response = await axios.get(`${gongConfig.baseUrl}/calls`, {
    headers: gongConfig.headers,
    params
  });

  let calls = response.data.records || response.data.calls || [];

  // Apply filters
  if (callType) {
    calls = calls.filter(call => determineCallType(call.title) === callType);
  }

  if (minDuration) {
    calls = calls.filter(call => (call.duration || 0) >= parseInt(minDuration));
  }

  // Sort calls
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

  // Process calls
  const processedCalls = calls.map(call => ({
    id: call.id,
    title: call.title,
    started: call.started,
    duration: call.duration,
    durationFormatted: formatDuration(call.duration),
    participants: call.parties?.length || 0,
    callType: determineCallType(call.title),
    hasRecording: !!(call.media && call.media.length > 0),
    sentiment: analyzeSentiment(call.title),
    isUserLed: isUserLeadingCall(call, userId)
  }));

  return {
    userId,
    calls: processedCalls,
    summary: {
      totalCalls: processedCalls.length,
      totalDuration: processedCalls.reduce((sum, call) => sum + (call.duration || 0), 0),
      averageDuration: processedCalls.length > 0 
        ? processedCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / processedCalls.length 
        : 0,
      callTypes: getCallTypeDistribution(processedCalls),
      userLedCalls: processedCalls.filter(call => call.isUserLed).length
    },
    filters: { callType, minDuration, fromDate, toDate },
    sorting: { sortBy, sortOrder }
  };
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

function getDepartmentDistribution(users) {
  const departments = {};
  users.forEach(user => {
    const dept = user.department || 'Unknown';
    departments[dept] = (departments[dept] || 0) + 1;
  });
  return departments;
}

function getTimezoneDistribution(users) {
  const timezones = {};
  users.forEach(user => {
    const tz = user.timezone || 'UTC';
    timezones[tz] = (timezones[tz] || 0) + 1;
  });
  return timezones;
}

function getMostCommonCallType(calls) {
  const types = {};
  calls.forEach(call => {
    const type = determineCallType(call.title);
    types[type] = (types[type] || 0) + 1;
  });
  
  return Object.entries(types).reduce((max, [type, count]) => 
    count > (max.count || 0) ? { type, count } : max, {}
  );
}

function determineCallType(title) {
  if (!title) return 'general';
  
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes('demo')) return 'demo';
  if (titleLower.includes('discovery')) return 'discovery';
  if (titleLower.includes('follow')) return 'follow-up';
  if (titleLower.includes('onboard')) return 'onboarding';
  if (titleLower.includes('check')) return 'check-in';
  if (titleLower.includes('close') || titleLower.includes('contract')) return 'closing';
  
  return 'general';
}

function getMostActiveDay(calls) {
  const dayCount = {};
  
  calls.forEach(call => {
    if (call.started) {
      const day = new Date(call.started).toLocaleDateString('en-US', { weekday: 'long' });
      dayCount[day] = (dayCount[day] || 0) + 1;
    }
  });

  return Object.entries(dayCount).reduce((max, [day, count]) => 
    count > (max.count || 0) ? { day, count } : max, {}
  );
}

function getCallDistribution(calls) {
  const hours = Array(24).fill(0);
  
  calls.forEach(call => {
    if (call.started) {
      const hour = new Date(call.started).getHours();
      hours[hour]++;
    }
  });

  return hours.map((count, hour) => ({ hour, count }));
}

function getPeakHours(calls) {
  const distribution = getCallDistribution(calls);
  return distribution
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(item => ({ hour: item.hour, calls: item.count }));
}

function getUniqueParticipants(calls) {
  const participants = new Set();
  
  calls.forEach(call => {
    if (call.parties) {
      call.parties.forEach(p => {
        if (p.emailAddress) {
          participants.add(p.emailAddress);
        }
      });
    }
  });

  return participants.size;
}

function getInternalExternalRatio(calls) {
  let internal = 0;
  let external = 0;
  
  calls.forEach(call => {
    if (call.parties) {
      call.parties.forEach(p => {
        if (p.role === 'sales' || p.role === 'internal') {
          internal++;
        } else {
          external++;
        }
      });
    }
  });
  
  return {
    internal,
    external,
    ratio: external > 0 ? (internal / external).toFixed(2) : 'N/A'
  };
}

function getFrequentCollaborators(calls, userId) {
  const collaborators = {};
  
  calls.forEach(call => {
    if (call.parties) {
      call.parties.forEach(p => {
        if (p.id !== userId && p.emailAddress) {
          const key = p.emailAddress;
          if (!collaborators[key]) {
            collaborators[key] = {
              name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.emailAddress,
              email: p.emailAddress,
              callCount: 0
            };
          }
          collaborators[key].callCount++;
        }
      });
    }
  });
  
  return Object.values(collaborators)
    .sort((a, b) => b.callCount - a.callCount)
    .slice(0, 5);
}

function getCallTypeDistribution(calls) {
  const types = {};
  calls.forEach(call => {
    const type = determineCallType(call.title);
    types[type] = (types[type] || 0) + 1;
  });
  return types;
}

function getCallTypeTrends(calls) {
  // Group calls by week and analyze call type trends
  const weeks = {};
  
  calls.forEach(call => {
    const date = new Date(call.started);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weeks[weekKey]) {
      weeks[weekKey] = {};
    }
    
    const type = determineCallType(call.title);
    weeks[weekKey][type] = (weeks[weekKey][type] || 0) + 1;
  });
  
  return weeks;
}

function calculateUserEngagementScore(calls) {
  // Simple engagement score based on call frequency and duration
  const totalCalls = calls.length;
  const avgDuration = calls.length > 0 
    ? calls.reduce((sum, call) => sum + (call.duration || 0), 0) / calls.length 
    : 0;
  
  let score = 0;
  
  // Call frequency score (0-40 points)
  if (totalCalls >= 20) score += 40;
  else if (totalCalls >= 10) score += 30;
  else if (totalCalls >= 5) score += 20;
  else if (totalCalls >= 1) score += 10;
  
  // Average duration score (0-30 points)
  if (avgDuration >= 3600) score += 30; // 1+ hour
  else if (avgDuration >= 1800) score += 25; // 30+ minutes
  else if (avgDuration >= 900) score += 20; // 15+ minutes
  else if (avgDuration >= 300) score += 10; // 5+ minutes
  
  // Consistency score (0-30 points)
  const consistency = calculateConsistencyScore(calls);
  score += Math.min(consistency * 0.3, 30);
  
  return Math.min(score, 100);
}

function calculateConsistencyScore(calls) {
  if (calls.length < 2) return 0;
  
  // Calculate how evenly distributed calls are over time
  const dates = calls.map(call => new Date(call.started).getTime()).sort();
  const timeSpan = dates[dates.length - 1] - dates[0];
  const expectedInterval = timeSpan / (calls.length - 1);
  
  let totalDeviation = 0;
  for (let i = 1; i < dates.length; i++) {
    const actualInterval = dates[i] - dates[i - 1];
    totalDeviation += Math.abs(actualInterval - expectedInterval);
  }
  
  const avgDeviation = totalDeviation / (dates.length - 1);
  const consistencyRatio = Math.max(0, 1 - (avgDeviation / expectedInterval));
  
  return consistencyRatio * 100;
}

function calculateProductivityScore(calls) {
  // Productivity based on call outcomes and types
  let score = 0;
  
  const demoCount = calls.filter(call => determineCallType(call.title) === 'demo').length;
  const discoveryCount = calls.filter(call => determineCallType(call.title) === 'discovery').length;
  const followUpCount = calls.filter(call => determineCallType(call.title) === 'follow-up').length;
  
  // Higher score for productive call types
  score += demoCount * 15;
  score += discoveryCount * 10;
  score += followUpCount * 8;
  
  // Bonus for variety in call types
  const uniqueTypes = new Set(calls.map(call => determineCallType(call.title))).size;
  score += uniqueTypes * 5;
  
  return Math.min(score, 100);
}

function analyzeSentiment(title) {
  if (!title) return 'neutral';
  
  const positive = ['great', 'excellent', 'good', 'positive', 'successful', 'interested', 'excited'];
  const negative = ['concern', 'issue', 'problem', 'objection', 'decline', 'cancel', 'postpone'];
  
  const titleLower = title.toLowerCase();
  
  if (positive.some(word => titleLower.includes(word))) return 'positive';
  if (negative.some(word => titleLower.includes(word))) return 'negative';
  
  return 'neutral';
}

function isUserLeadingCall(call, userId) {
  // Simple heuristic: user is leading if they are the first participant or organizer
  if (!call.parties || call.parties.length === 0) return false;
  
  // Check if user is the organizer (if that data is available)
  if (call.organizer && call.organizer.id === userId) return true;
  
  // Check if user is first in the participants list (common pattern for organizers)
  return call.parties[0]?.id === userId;
}