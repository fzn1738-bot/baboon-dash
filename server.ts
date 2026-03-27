import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import admin from 'firebase-admin';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import { getFirestore as getClientFirestore, doc as clientDoc, setDoc as clientSetDoc, getDoc as clientGetDoc, updateDoc as clientUpdateDoc, collection as clientCollection, query as clientQuery, where as clientWhere, limit as clientLimit, getDocs as clientGetDocs, addDoc as clientAddDoc, serverTimestamp as clientServerTimestamp } from 'firebase/firestore';
import { Resend } from 'resend';

// Read config
const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Initialize Firebase Client SDK for backend workarounds
const clientApp = initializeClientApp(config);
const clientDb = getClientFirestore(clientApp, config.firestoreDatabaseId);

// Initialize Firebase Admin
let firebaseAdminApp;
try {
  if (!admin.apps.length) {
    console.log(`Initializing Firebase Admin with Project ID: ${config.projectId}...`);
    firebaseAdminApp = admin.initializeApp({
      projectId: config.projectId,
    });
  } else {
    firebaseAdminApp = admin.app();
  }
} catch (e) {
  console.error("Firebase Admin initialization error:", e);
  firebaseAdminApp = admin.app();
}

const dbId = config.firestoreDatabaseId;

// Use Admin SDK firestore with databaseId
const adminFirestore = getAdminFirestore(firebaseAdminApp, dbId);
console.log("Initializing Admin Firestore with Database ID:", dbId);

// Global state for startup tests
const startupTestResults: any = {
  configured: { status: 'pending' },
  env: {
    projectId: config.projectId,
    dbId: dbId,
  }
};

let lastWebhookMessage: any = null;
let webhookHistory: any[] = [];
let serverLogs: string[] = [];

// Capture console logs
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const addServerLog = (type: string, ...args: any[]) => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  const logEntry = `[${timestamp}] [${type}] ${message}`;
  serverLogs = [logEntry, ...serverLogs].slice(0, 100);
};

console.log = (...args) => {
  addServerLog('INFO', ...args);
  originalLog(...args);
};

console.error = (...args) => {
  addServerLog('ERROR', ...args);
  originalError(...args);
};

console.warn = (...args) => {
  addServerLog('WARN', ...args);
  originalWarn(...args);
};

// Test writes to check permissions on startup
async function runStartupTests() {
  console.log("--- Running Firestore Startup Tests ---");
  
  // Test 1: Admin SDK (The most reliable for server-side)
  try {
    const doc = await adminFirestore.collection('test_connection').add({ 
      time: admin.firestore.FieldValue.serverTimestamp(),
      message: `Admin SDK test on database: ${dbId}`,
      environment: process.env.NODE_ENV || 'development'
    });
    console.log(`✅ Firestore Admin SDK test write successful. Doc ID: ${doc.id}`);
    startupTestResults.admin = { status: 'success', id: doc.id };
  } catch (err: any) {
    console.error(`❌ Firestore Admin SDK test write FAILED!`);
    console.error("Error Message:", err.message);
    startupTestResults.admin = { 
      status: 'failed', 
      message: err.message,
    };
  }

  // Test 2: Client SDK (Checks security rules)
  try {
    const testId = `client_test_${Date.now()}`;
    await clientSetDoc(clientDoc(clientDb, 'test_connection', testId), { 
      time: clientServerTimestamp(),
      message: `Client SDK test on database: ${dbId}`,
      environment: process.env.NODE_ENV || 'development'
    });
    console.log(`✅ Firestore Client SDK test write successful.`);
    startupTestResults.client = { status: 'success' };
  } catch (err: any) {
    console.error(`⚠️ Firestore Client SDK test write FAILED (This is expected if not logged in)!`);
    startupTestResults.client = { 
      status: 'failed', 
      message: err.message,
    };
  }
  console.log("--- End of Firestore Startup Tests ---");
}

runStartupTests();

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);
  const httpServer = http.createServer(app);

  app.use(cors());
  
  // Proxy Bybit API
  app.use('/v5', createProxyMiddleware({
    target: 'https://api.bybit.com/v5',
    changeOrigin: true,
    secure: false,
    pathRewrite: {
      '^/v5': '', // Strip the local /v5 so it doesn't become /v5/v5
    },
  }));

  app.use(express.json());

  // Global request logger for debugging
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/webhook')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    }
    next();
  });

  // API routes FIRST
  app.get("/api/admin/logs", (req, res) => {
    res.json({ logs: serverLogs });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/debug/firestore", (req, res) => {
    res.json(startupTestResults);
  });

  app.get("/api/webhook/last", (req, res) => {
    res.json({ lastMessage: lastWebhookMessage });
  });

  app.get("/api/test", (req, res) => {
    res.json({ status: "post ok" });
  });

  // Email sending endpoint
  app.post("/api/send-email", async (req, res) => {
    try {
      const { to, subject, html } = req.body;
      const resendApiKey = process.env.RESEND_API_KEY;
      
      if (!resendApiKey) {
        console.warn("RESEND_API_KEY is not set. Email not sent.");
        return res.status(200).json({ success: true, warning: "RESEND_API_KEY not set" });
      }

      const resend = new Resend(resendApiKey);
      const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';

      const data = await resend.emails.send({
        from: `Baboon Dashboard <${fromEmail}>`,
        to,
        subject,
        html,
      });

      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  // NOWPayments Config
  const NOWPAYMENTS_API_KEY = "E5J471H-CM64AWF-KTA0237-2W7TN67";
  const NOWPAYMENTS_IPN_SECRET = "Y37qz5ag7p0gSA8uY2H/mR2lS/PJdNmE";

  // Create NOWPayments Invoice
  app.post("/api/payment/invoice", async (req, res) => {
    console.log("HIT /api/payment/invoice");
    try {
      const { amount, userId, userEmail, currency } = req.body;
      console.log("Body:", req.body);
      if (!amount || !userId) return res.status(400).json({ error: "Missing required fields" });

      const amountNum = Number(amount);
      const investedAmount = amountNum * 0.82; // 18% fee, 82% invested
      const orderId = `${userId}_${Date.now()}`;

      console.log("Creating deposit record with data:", {
        userId,
        userEmail,
        totalAmount: amountNum,
        investedAmount,
        status: 'PENDING',
        currency: currency || 'ltc',
      });
      // Create a pending deposit record in Firestore using Client SDK (subject to rules)
      try {
        console.log(`Attempting write to database: ${dbId} using Client SDK`);
        await clientSetDoc(clientDoc(clientDb, 'deposits', orderId), {
          userId,
          userEmail,
          totalAmount: amountNum,
          investedAmount,
          status: 'PENDING',
          currency: currency || 'ltc',
          createdAt: clientServerTimestamp()
        });
        
        // Update user's pendingInvested
        const userRef = clientDoc(clientDb, 'users', userId);
        const userDoc = await clientGetDoc(userRef);
        if (userDoc.exists()) {
          const currentPending = userDoc.data()?.pendingInvested || 0;
          await clientUpdateDoc(userRef, {
            pendingInvested: currentPending + investedAmount
          });
        }

        console.log("Deposit record and pending amount updated successfully via Client SDK.");
      } catch (dbError: any) {
        console.error(`Firestore write failed for database ${dbId} via Client SDK:`, dbError.message);
        throw dbError;
      }

      // We need the APP_URL to set the IPN callback
      const host = req.get('host');
      const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const appUrl = process.env.APP_URL || `${protocol}://${host}`;

      console.log("Fetching NOWPayments...");
      const response = await fetch('https://api.nowpayments.io/v1/invoice', {
        method: 'POST',
        headers: {
          'x-api-key': NOWPAYMENTS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          price_amount: amountNum,
          price_currency: 'usd',
          pay_currency: currency || 'ltc',
          order_id: orderId,
          order_description: `Investment Capital for ${userEmail || userId}`,
          ipn_callback_url: `${appUrl}/api/webhook/nowpayments`,
          success_url: `${appUrl}/`,
          cancel_url: `${appUrl}/`
        })
      });

      console.log("NOWPayments response status:", response.status);
      const data = await response.json();
      console.log("NOWPayments response data:", data);
      
      if (!response.ok) {
        console.error("NOWPayments Error:", data);
        const errorMsg = data.message || data.error || (data.errors ? JSON.stringify(data.errors) : "Failed to create invoice");
        return res.status(500).json({ error: errorMsg });
      }

      res.json({ invoice_url: data.invoice_url });
    } catch (error) {
      console.error("Invoice generation error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // NOWPayments IPN Webhook
  app.post("/api/webhook/nowpayments", async (req, res) => {
    try {
      const crypto = await import('crypto');
      const sig = req.headers['x-nowpayments-sig'];
      
      if (!sig) return res.status(401).json({ error: "No signature" });

      // Verify signature
      const hmac = crypto.createHmac('sha512', NOWPAYMENTS_IPN_SECRET);
      hmac.update(JSON.stringify(req.body, Object.keys(req.body).sort()));
      const signature = hmac.digest('hex');

      if (signature !== sig) {
        console.error("Invalid NOWPayments signature");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const { payment_status, order_id, actually_paid } = req.body;

      if (payment_status === 'finished' || payment_status === 'confirmed') {
        const depositRef = clientDoc(clientDb, 'deposits', order_id);
        const depositDoc = await clientGetDoc(depositRef);

        if (depositDoc.exists() && depositDoc.data()?.status === 'PENDING') {
          const data = depositDoc.data()!;
          const userId = data.userId;
          const investedAmount = data.investedAmount;

          // Mark deposit as completed
          await clientUpdateDoc(depositRef, {
            status: 'COMPLETED',
            actuallyPaid: actually_paid,
            completedAt: clientServerTimestamp()
          });

          // Update user's totalInvested and pendingInvested
          const userRef = clientDoc(clientDb, 'users', userId);
          const userDoc = await clientGetDoc(userRef);
          
          if (userDoc.exists()) {
            const currentTotal = userDoc.data()?.totalInvested || 0;
            const currentPending = userDoc.data()?.pendingInvested || 0;
            
            await clientUpdateDoc(userRef, {
              totalInvested: currentTotal + investedAmount,
              pendingInvested: Math.max(0, currentPending - investedAmount)
            });
          }
        }
      } else if (payment_status === 'failed' || payment_status === 'expired') {
        const depositRef = clientDoc(clientDb, 'deposits', order_id);
        const depositDoc = await clientGetDoc(depositRef);

        if (depositDoc.exists() && depositDoc.data()?.status === 'PENDING') {
          const data = depositDoc.data()!;
          const userId = data.userId;
          const investedAmount = data.investedAmount;

          // Mark deposit as failed
          await clientUpdateDoc(depositRef, {
            status: 'FAILED',
            completedAt: clientServerTimestamp()
          });

          // Update user's pendingInvested
          const userRef = clientDoc(clientDb, 'users', userId);
          const userDoc = await clientGetDoc(userRef);
          
          if (userDoc.exists()) {
            const currentPending = userDoc.data()?.pendingInvested || 0;
            await clientUpdateDoc(userRef, {
              pendingInvested: Math.max(0, currentPending - investedAmount)
            });
          }
        }
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error("NOWPayments Webhook Error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Webhook to receive trades from Discord Bot or other sources
  app.get(["/api/webhook/trades", "/api/webhook/trades/"], (req, res) => {
    res.json({
      status: "active",
      lastMessage: lastWebhookMessage || "No messages received yet.",
      history: webhookHistory
    });
  });

  app.get("/api/webhook/last", (req, res) => {
    res.json(lastWebhookMessage || { message: "No messages received yet." });
  });

  app.post(["/api/webhook/trades", "/api/webhook/trades/"], async (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] --- Webhook Received: /api/webhook/trades ---`);
    console.log(`[${timestamp}] Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`[${timestamp}] Body:`, JSON.stringify(req.body, null, 2));
    
    const newMessage = {
      timestamp: timestamp,
      headers: req.headers,
      body: req.body
    };
    
    lastWebhookMessage = newMessage;
    webhookHistory = [newMessage, ...webhookHistory].slice(0, 10);
    
    try {
      const { secret_key, status, side, symbol, entry_price, exit_price, leverage, trade_pnl, trade_roi_percent, trade_account_raw_percent, reason, content } = req.body;
      
      // Log the raw content for debugging
      if (content) console.log(`[${timestamp}] Raw Content: "${content}"`);

      // Basic security check
      const expectedSecret = process.env.WEBHOOK_SECRET || "YOUR_SECURE_PASSWORD";
      if (process.env.WEBHOOK_SECRET && secret_key !== expectedSecret) {
        console.warn(`[${timestamp}] Unauthorized webhook attempt. Received: ${secret_key || 'NONE'}`);
        return res.status(401).json({ error: "Unauthorized" });
      }

      const parsedData: any = {
        status: status || "CLOSED",
        side: side || "UNKNOWN",
        symbol: symbol || "UNKNOWN",
        entryPrice: entry_price || 0,
        exitPrice: exit_price || 0,
        leverage: leverage || 1,
        tradePnl: trade_pnl || 0,
        tradeRoiPercent: trade_roi_percent || 0,
        tradeAccountRawPercent: trade_account_raw_percent || 0,
        reason: reason || "",
      };

      // Parse Discord message content if provided
      if (content && typeof content === 'string') {
        const isClosed = content.includes("CLOSED:");
        const isOpen = content.includes("OPEN:") || content.includes("ACTIVE POSITION:");

        console.log(`[${timestamp}] Parsing content. isOpen: ${isOpen}, isClosed: ${isClosed}`);

        if (isOpen) {
          parsedData.status = "OPEN";
          
          // Try to match symbol from various formats
          const symbolMatch = content.match(/(?:OPEN|ACTIVE POSITION):\s*([A-Z0-9-]+)/i);
          if (symbolMatch) {
            parsedData.symbol = symbolMatch[1];
            console.log(`[${timestamp}] Matched symbol: ${parsedData.symbol}`);
          }

          // Try to match side
          if (content.match(/LONG/i)) parsedData.side = "LONG";
          else if (content.match(/SHORT/i)) parsedData.side = "SHORT";
          else if (content.match(/BUY/i)) parsedData.side = "LONG";
          else if (content.match(/SELL/i)) parsedData.side = "SHORT";

          console.log(`[${timestamp}] Matched side: ${parsedData.side}`);

          const sideLevMatch = content.match(/Side:\s*(BUY|SELL|LONG|SHORT)\s*\|\s*Leverage:\s*(\d+)x/i);
          if (sideLevMatch) {
            parsedData.side = sideLevMatch[1].toUpperCase() === 'BUY' ? 'LONG' : (sideLevMatch[1].toUpperCase() === 'SELL' ? 'SHORT' : sideLevMatch[1].toUpperCase());
            parsedData.leverage = parseInt(sideLevMatch[2], 10);
          }

          const entryMarkMatch = content.match(/Entry:\s*\$([\d,.]+)\s*➔\s*Mark:\s*\$([\d,.]+)/i);
          if (entryMarkMatch) {
            parsedData.entryPrice = parseFloat(entryMarkMatch[1].replace(/,/g, ''));
          }

          const pnlMatch = content.match(/Unrealized PnL:\s*([+-]?[\d.]+)%/i);
          if (pnlMatch) parsedData.tradeRoiPercent = parseFloat(pnlMatch[1]);

          const rawMatch = content.match(/Account Raw:\s*([+-]?[\d.]+)%/i);
          if (rawMatch) parsedData.tradeAccountRawPercent = parseFloat(rawMatch[1]);
          
        } else if (isClosed) {
          parsedData.status = "CLOSED";
          
          // Try to match symbol and side
          const closedMatch = content.match(/(?:✅|❌)?\s*(LONG|SHORT)\s*CLOSED:\s*([A-Z0-9-]+)/i);
          if (closedMatch) {
            parsedData.side = closedMatch[1].toUpperCase();
            parsedData.symbol = closedMatch[2];
          } else {
            const symbolOnlyMatch = content.match(/CLOSED:\s*([A-Z0-9-]+)/i);
            if (symbolOnlyMatch) parsedData.symbol = symbolOnlyMatch[1];
            
            if (content.match(/LONG/i)) parsedData.side = "LONG";
            else if (content.match(/SHORT/i)) parsedData.side = "SHORT";
          }

          const entryMatch = content.match(/Entry Price:\s*\$([\d,.]+)/i);
          if (entryMatch) parsedData.entryPrice = parseFloat(entryMatch[1].replace(/,/g, ''));

          const exitMatch = content.match(/Exit Price:\s*\$([\d,.]+)/i);
          if (exitMatch) parsedData.exitPrice = parseFloat(exitMatch[1].replace(/,/g, ''));

          const levMatch = content.match(/Leverage:\s*(\d+)x/i);
          if (levMatch) parsedData.leverage = parseInt(levMatch[1], 10);

          const pnlMatch = content.match(/Trade PnL:\s*([+-]?[\d.]+)\s*USDT/i);
          if (pnlMatch) parsedData.tradePnl = parseFloat(pnlMatch[1]);

          const roiMatch = content.match(/Trade ROI %:\s*([+-]?[\d.]+)%/i);
          if (roiMatch) parsedData.tradeRoiPercent = parseFloat(roiMatch[1]);

          const rawMatch = content.match(/Trade Account Raw %:\s*([+-]?[\d.]+)%/i);
          if (rawMatch) parsedData.tradeAccountRawPercent = parseFloat(rawMatch[1]);
          
          const monthlyRoiMatch = content.match(/Monthly Trade ROI %:\s*([+-]?[\d.]+)%\s*\(Quarterly Cumulative %:\s*([+-]?[\d.]+)%\)/i);
          if (monthlyRoiMatch) {
            parsedData.monthlyTradeRoiPercent = parseFloat(monthlyRoiMatch[1]);
            parsedData.quarterlyCumulativePercent = parseFloat(monthlyRoiMatch[2]);
          }

          const monthlyRawMatch = content.match(/Monthly Account Raw %:\s*([+-]?[\d.]+)%\s*\(Quarterly Account Raw %:\s*([+-]?[\d.]+)%\)/i);
          if (monthlyRawMatch) {
            parsedData.monthlyAccountRawPercent = parseFloat(monthlyRawMatch[1]);
            parsedData.quarterlyAccountRawPercent = parseFloat(monthlyRawMatch[2]);
          }

          const monthlyPnlMatch = content.match(/Monthly PnL:\s*([+-]?[\d.]+)\s*USDT\s*\(Quarterly PnL:\s*([+-]?[\d.]+)\s*USDT\)/i);
          if (monthlyPnlMatch) {
            parsedData.monthlyPnl = parseFloat(monthlyPnlMatch[1]);
            parsedData.quarterlyPnl = parseFloat(monthlyPnlMatch[2]);
          }

          const prevQuarterMatch = content.match(/Previous Quarter %:\s*([+-]?[\d.]+)%\s*ROI\s*\(Account Raw:\s*([+-]?[\d.]+)%\)/i);
          if (prevQuarterMatch) {
            parsedData.previousQuarterRoiPercent = parseFloat(prevQuarterMatch[1]);
            parsedData.previousQuarterAccountRawPercent = parseFloat(prevQuarterMatch[2]);
          }

          const reasonMatch = content.match(/Reason:\s*(.+)/i);
          if (reasonMatch) parsedData.reason = reasonMatch[1].trim();
        }
      }

      console.log(`[${timestamp}] Final Parsed Data:`, JSON.stringify(parsedData, null, 2));

      const tradeData = {
        ...parsedData,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (tradeData.status === "OPEN") {
        // Check if open trade already exists for this symbol to avoid duplicates
        const existingOpenSnapshot = await adminFirestore.collection('trades')
          .where('status', '==', 'OPEN')
          .where('symbol', '==', tradeData.symbol)
          .limit(1)
          .get();
          
        if (!existingOpenSnapshot.empty) {
          // Update existing open trade with latest unrealized PnL
          const docSnap = existingOpenSnapshot.docs[0];
          await docSnap.ref.update({
            tradeRoiPercent: tradeData.tradeRoiPercent,
            tradeAccountRawPercent: tradeData.tradeAccountRawPercent,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`Updated existing OPEN trade: ${docSnap.id} for ${tradeData.symbol}`);
          return res.json({ success: true, id: docSnap.id, updated: true });
        } else {
          const docRef = await adminFirestore.collection('trades').add(tradeData);
          console.log(`Created new OPEN trade: ${docRef.id} for ${tradeData.symbol}`);
          return res.json({ success: true, id: docRef.id });
        }
      } else if (tradeData.status === "CLOSED") {
        const openTradesSnapshot = await adminFirestore.collection('trades')
          .where('status', '==', 'OPEN')
          .where('symbol', '==', tradeData.symbol)
          .limit(1)
          .get();
 
        if (!openTradesSnapshot.empty) {
          const docSnap = openTradesSnapshot.docs[0];
          await docSnap.ref.update({
            status: "CLOSED",
            exitPrice: tradeData.exitPrice,
            tradePnl: tradeData.tradePnl,
            tradeRoiPercent: tradeData.tradeRoiPercent,
            tradeAccountRawPercent: tradeData.tradeAccountRawPercent,
            monthlyTradeRoiPercent: tradeData.monthlyTradeRoiPercent || null,
            quarterlyCumulativePercent: tradeData.quarterlyCumulativePercent || null,
            monthlyAccountRawPercent: tradeData.monthlyAccountRawPercent || null,
            quarterlyAccountRawPercent: tradeData.quarterlyAccountRawPercent || null,
            monthlyPnl: tradeData.monthlyPnl || null,
            quarterlyPnl: tradeData.quarterlyPnl || null,
            previousQuarterRoiPercent: tradeData.previousQuarterRoiPercent || null,
            previousQuarterAccountRawPercent: tradeData.previousQuarterAccountRawPercent || null,
            reason: tradeData.reason,
            closeTimestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`Closed existing trade: ${docSnap.id} for ${tradeData.symbol}`);
          return res.json({ success: true, id: docSnap.id, updated: true });
        } else {
          const docRef = await adminFirestore.collection('trades').add(tradeData);
          console.log(`Created new CLOSED trade: ${docRef.id} for ${tradeData.symbol}`);
          return res.json({ success: true, id: docRef.id });
        }
      }
      
      console.log("Webhook processed successfully but no trade action taken (status not OPEN/CLOSED).");
      res.json({ success: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { 
        middlewareMode: true, 
        hmr: false
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
