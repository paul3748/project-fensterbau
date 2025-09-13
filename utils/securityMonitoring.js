// utils/securityMonitoring.js
const nodemailer = require('nodemailer');
const { logger, securityLogger } = require('./logger');

class SecurityMonitor {
  constructor() {
    this.alertThresholds = {
      loginFailures: 5,      // 5 fehlgeschlagene Logins in 10 Min
      timeWindow: 10 * 60 * 1000, // 10 Minuten
      rateLimitHits: 10,     // 10 Rate Limit Hits in 5 Min
      suspiciousPatterns: 3   // 3 verdächtige Anfragen in 5 Min
    };
    
    this.recentEvents = new Map();
    this.emailTransporter = this.setupEmailTransporter();
    
    // Cleanup alle 30 Minuten
    setInterval(() => this.cleanupOldEvents(), 30 * 60 * 1000);
  }
  
  setupEmailTransporter() {
    if (!process.env.ENABLE_SECURITY_ALERTS) return null;
    
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });
  }
  
  // Event-Tracking
  trackSecurityEvent(eventType, req, details = {}) {
    const now = Date.now();
    const ip = req.ip;
    const key = `${eventType}_${ip}`;
    
    if (!this.recentEvents.has(key)) {
      this.recentEvents.set(key, []);
    }
    
    const events = this.recentEvents.get(key);
    events.push({ timestamp: now, details });
    
    // Alte Events entfernen
    const cutoff = now - this.alertThresholds.timeWindow;
    const recentEvents = events.filter(event => event.timestamp > cutoff);
    this.recentEvents.set(key, recentEvents);
    
    // Alert prüfen
    this.checkForAlerts(eventType, ip, recentEvents, req);
    
    // Security Event loggen
    securityLogger.warn({
      eventType,
      ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
      details
    });
  }
  
  checkForAlerts(eventType, ip, events, req) {
    let shouldAlert = false;
    let alertMessage = '';
    
    switch (eventType) {
      case 'LOGIN_FAILED':
        if (events.length >= this.alertThresholds.loginFailures) {
          shouldAlert = true;
          alertMessage = `${events.length} fehlgeschlagene Login-Versuche von IP ${ip} in den letzten 10 Minuten`;
        }
        break;
        
      case 'RATE_LIMIT_EXCEEDED':
        if (events.length >= this.alertThresholds.rateLimitHits) {
          shouldAlert = true;
          alertMessage = `${events.length} Rate-Limit-Überschreitungen von IP ${ip} in den letzten 10 Minuten`;
        }
        break;
        
      case 'SUSPECTED_INJECTION_ATTEMPT':
      case 'SUSPICIOUS_ACTIVITY':
        if (events.length >= this.alertThresholds.suspiciousPatterns) {
          shouldAlert = true;
          alertMessage = `${events.length} verdächtige Aktivitäten von IP ${ip} erkannt`;
        }
        break;
        
      case 'UNAUTHORIZED_ACCESS_ATTEMPT':
        if (events.length >= 3) {
          shouldAlert = true;
          alertMessage = `Wiederholte unbefugte Zugriffe von IP ${ip}`;
        }
        break;
    }
    
    if (shouldAlert) {
      this.sendSecurityAlert(eventType, ip, alertMessage, events, req);
    }
  }
  
  async sendSecurityAlert(eventType, ip, message, events, req) {
    const alertData = {
      timestamp: new Date().toISOString(),
      eventType,
      ip,
      message,
      eventsCount: events.length,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl,
      recentEvents: events.slice(-5) // Letzte 5 Events
    };
    
    // Critical Alert loggen
    logger.error('SECURITY ALERT', alertData);
    
    // Email-Benachrichtigung (falls konfiguriert)
    if (this.emailTransporter && process.env.SECURITY_EMAIL) {
      try {
        await this.emailTransporter.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.SECURITY_EMAIL,
          subject: `🚨 Security Alert: ${eventType}`,
          html: this.generateAlertHTML(alertData)
        });
        
        logger.info('Security alert email sent successfully');
      } catch (error) {
        logger.error('Failed to send security alert email', { error: error.message });
      }
    }
    
    // Weitere Aktionen (z.B. Slack, Discord, etc.)
    this.triggerAdditionalAlerts(alertData);
  }
  
  generateAlertHTML(alertData) {
    return `
      <h2>🚨 Security Alert</h2>
      <p><strong>Zeit:</strong> ${alertData.timestamp}</p>
      <p><strong>Event-Typ:</strong> ${alertData.eventType}</p>
      <p><strong>IP-Adresse:</strong> ${alertData.ip}</p>
      <p><strong>Nachricht:</strong> ${alertData.message}</p>
      <p><strong>Anzahl Events:</strong> ${alertData.eventsCount}</p>
      <p><strong>User-Agent:</strong> ${alertData.userAgent}</p>
      <p><strong>URL:</strong> ${alertData.url}</p>
      
      <h3>Letzte Events:</h3>
      <ul>
        ${alertData.recentEvents.map(event => 
          `<li>${new Date(event.timestamp).toLocaleString()}: ${JSON.stringify(event.details)}</li>`
        ).join('')}
      </ul>
      
      <p><em>Diese Nachricht wurde automatisch vom Security Monitoring System generiert.</em></p>
    `;
  }
  
  async triggerAdditionalAlerts(alertData) {
    // Webhook für Slack/Discord/etc.
    if (process.env.SECURITY_WEBHOOK_URL) {
      try {
        const response = await fetch(process.env.SECURITY_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `🚨 Security Alert: ${alertData.eventType}`,
            attachments: [{
              color: 'danger',
              fields: [
                { title: 'IP-Adresse', value: alertData.ip, short: true },
                { title: 'Events', value: alertData.eventsCount.toString(), short: true },
                { title: 'Details', value: alertData.message, short: false }
              ]
            }]
          })
        });
        
        if (response.ok) {
          logger.info('Webhook alert sent successfully');
        }
      } catch (error) {
        logger.error('Failed to send webhook alert', { error: error.message });
      }
    }
  }
  
  cleanupOldEvents() {
    const now = Date.now();
    const cutoff = now - (this.alertThresholds.timeWindow * 2); // 2x Zeitfenster
    
    for (const [key, events] of this.recentEvents) {
      const filteredEvents = events.filter(event => event.timestamp > cutoff);
      if (filteredEvents.length === 0) {
        this.recentEvents.delete(key);
      } else {
        this.recentEvents.set(key, filteredEvents);
      }
    }
  }
  
  // IP-Reputation Check (einfache Implementierung)
  async checkIPReputation(ip) {
    // Lokale Blacklist
    const knownBadIPs = new Set([
      // Hier bekannte schlechte IPs eintragen
    ]);
    
    if (knownBadIPs.has(ip)) {
      return { isMalicious: true, reason: 'Local blacklist' };
    }
    
    // Hier könnte Integration mit externen IP-Reputation-Services erfolgen
    // z.B. VirusTotal, AbuseIPDB, etc.
    
    return { isMalicious: false };
  }
  
  // Anomalie-Erkennung für ungewöhnliche Patterns
  detectAnomalies(req) {
    const userAgent = req.get('User-Agent') || '';
    const url = req.originalUrl;
    
    const anomalies = [];
    
    // Verdächtige User-Agents
    const suspiciousUAPatterns = [
      /sqlmap/i,
      /nmap/i,
      /nikto/i,
      /curl/i,
      /wget/i,
      /python-requests/i,
      /bot.*scan/i
    ];
    
    if (suspiciousUAPatterns.some(pattern => pattern.test(userAgent))) {
      anomalies.push('Suspicious User-Agent');
    }
    
    // Verdächtige URLs
    const suspiciousURLPatterns = [
      /\.(php|asp|jsp)$/i,
      /\/admin/i,
      /\/wp-admin/i,
      /\/phpmyadmin/i,
      /\/config/i,
      /\/\.env/i,
      /\/\.git/i
    ];
    
    if (suspiciousURLPatterns.some(pattern => pattern.test(url))) {
      anomalies.push('Suspicious URL pattern');
    }
    
    // Ungewöhnliche Header
    const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip', 'x-originating-ip'];
    const hasMultipleProxyHeaders = suspiciousHeaders.filter(header => req.headers[header]).length > 1;
    
    if (hasMultipleProxyHeaders) {
      anomalies.push('Multiple proxy headers');
    }
    
    return anomalies;
  }
  
  // Dashboard-Daten für Admin-Interface
  getSecurityDashboard() {
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);
    
    const stats = {
      totalEvents: 0,
      eventsByType: {},
      topIPs: {},
      recentAlerts: []
    };
    
    for (const [key, events] of this.recentEvents) {
      const [eventType, ip] = key.split('_');
      const recentEvents = events.filter(event => event.timestamp > last24h);
      
      stats.totalEvents += recentEvents.length;
      stats.eventsByType[eventType] = (stats.eventsByType[eventType] || 0) + recentEvents.length;
      stats.topIPs[ip] = (stats.topIPs[ip] || 0) + recentEvents.length;
    }
    
    return stats;
  }
}

// Singleton Instance
const securityMonitor = new SecurityMonitor();

// Middleware für automatisches Event-Tracking
const trackSecurityMiddleware = (eventType) => {
  return (req, res, next) => {
    const anomalies = securityMonitor.detectAnomalies(req);
    
    if (anomalies.length > 0) {
      securityMonitor.trackSecurityEvent('SUSPICIOUS_ACTIVITY', req, { anomalies });
    }
    
    // Original Event auch tracken falls gewünscht
    if (eventType) {
      securityMonitor.trackSecurityEvent(eventType, req);
    }
    
    next();
  };
};

module.exports = {
  securityMonitor,
  trackSecurityMiddleware
};