import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import { createProxyMiddleware } from 'http-proxy-middleware';
import admin from 'firebase-admin';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { Resend } from 'resend';
import dotenv from 'dotenv';

// Load environment variables from .env file if present
dotenv.config();

// Read config
const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

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
    res.json({ 
      status: "ok", 
      hasApiKey: !!process.env.BYBIT_API_KEY, 
      hasApiSecret: !!process.env.BYBIT_API_SECRET 
    });
  });

  app.get("/api/webhook/last", (req, res) => {
    res.json({ lastMessage: lastWebhookMessage });
  });

  app.get("/api/test", (req, res) => {
    res.json({ status: "post ok" });
  });

  // Bybit API Proxy Endpoints
  const BYBIT_API_KEY = process.env.BYBIT_API_KEY || '';
  const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET || '';
  const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
  const RECV_WINDOW = 10000;

  const generateBybitSignature = (timestamp: number, queryString: string) => {
    const preHash = timestamp.toString() + BYBIT_API_KEY + RECV_WINDOW.toString() + queryString;
    return crypto.createHmac('sha256', BYBIT_API_SECRET).update(preHash).digest('hex');
  };

  const buildBybitQueryString = (params: Record<string, string>) => {
    const keys = Object.keys(params).sort();
    const searchParams = new URLSearchParams();
    keys.forEach(key => searchParams.append(key, params[key]));
    return searchParams.toString();
  };

  const fetchFromBybit = async (endpoint: string, params: Record<string, string>) => {
    if (!BYBIT_API_KEY || !BYBIT_API_SECRET) {
      console.error("[Bybit Backend] Missing BYBIT_API_KEY or BYBIT_API_SECRET");
      return { error: "Missing API Keys", details: "Please configure Bybit API keys in the environment." };
    }
    const timestamp = Date.now();
    const queryString = buildBybitQueryString(params);
    const signature = generateBybitSignature(timestamp, queryString);
    
    const headers = {
        'X-BAPI-API-KEY': BYBIT_API_KEY,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': RECV_WINDOW.toString(),
        'Content-Type': 'application/json',
    };

    const url = `${BYBIT_BASE_URL}/v5${endpoint}?${queryString}`;
    try {
        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) {
            const text = await response.text();
            console.error(`[Bybit Backend] Error ${response.status}: ${text.substring(0, 200)}`);
            return { error: `HTTP ${response.status}`, details: text };
        }
        const data = await response.json();
        if (data.retCode !== 0) {
            console.error(`[Bybit Backend] Logic Error [${data.retCode}]:`, data.retMsg);
            return { error: `API Error ${data.retCode}`, details: data.retMsg };
        }
        return data;
    } catch (error) {
        console.error("[Bybit Backend] Network error:", error);
        return { error: "Network Error", details: String(error) };
    }
  };

  app.get("/api/bybit/positions", async (req, res) => {
    try {
        const categoryQuery = String(req.query.categories || 'linear,inverse');
        const requestedCategories = categoryQuery
            .split(',')
            .map(c => c.trim())
            .filter(Boolean);

        const buildPositionParamSets = (category: string): Record<string, string>[] => {
            if (category === 'linear') {
                return [
                    { category: 'linear', settleCoin: 'USDT', limit: '200' },
                    { category: 'linear', settleCoin: 'USDC', limit: '200' }
                ];
            }
            if (category === 'inverse') {
                return ['BTC', 'ETH', 'XRP', 'SOL', 'DOT'].map((coin) => ({
                    category: 'inverse',
                    settleCoin: coin,
                    limit: '200'
                }));
            }
            if (category === 'option') {
                return ['BTC', 'ETH'].map((coin) => ({
                    category: 'option',
                    baseCoin: coin,
                    limit: '200'
                }));
            }
            return [{ category, limit: '200' }];
        };

        const fetchPaginatedPositions = async (baseParams: Record<string, string>) => {
            const all: any[] = [];
            let cursor = '';
            const seenCursors = new Set<string>();

            while (true) {
                const params: Record<string, string> = { ...baseParams };
                if (cursor) {
                    params.cursor = cursor;
                    if (seenCursors.has(cursor)) break;
                    seenCursors.add(cursor);
                }

                const data = await fetchFromBybit('/position/list', params);
                if (data?.error) {
                    return { error: data.error, details: data.details };
                }

                const list = data?.result?.list || [];
                all.push(...list);

                cursor = data?.result?.nextPageCursor || '';
                if (!cursor || list.length === 0) break;
            }

            return { list: all };
        };

        const categoryResults = await Promise.all(
            requestedCategories.flatMap((category) =>
                buildPositionParamSets(category).map(async (paramSet) => ({
                    category,
                    params: paramSet,
                    ...(await fetchPaginatedPositions(paramSet))
                }))
            )
        );

        const warnings = categoryResults
            .filter((result: any) => !!result.error)
            .map((result: any) => ({
                category: result.category,
                params: result.params,
                error: result.error,
                details: result.details
            }));

        const allPositions = categoryResults.flatMap((result: any) => result.list || []);
        if (allPositions.length === 0 && warnings.length > 0) {
            return res.status(400).json({ success: false, error: warnings[0].error, details: warnings[0].details, warnings });
        }

        res.json({ success: true, list: allPositions, warnings });
    } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get("/api/bybit/closed-pnl", async (req, res) => {
    try {
        const lookbackDaysInput = Number.parseInt(String(req.query.lookbackDays || '365'), 10);
        const lookbackDays = Number.isFinite(lookbackDaysInput) && lookbackDaysInput > 0 ? Math.min(lookbackDaysInput, 730) : 365;
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const sevenDaysMs = 7 * dayMs;
        const earliestAllowedTime = now - (730 * dayMs) + (60 * 1000);
        const requestedStartTime = now - (lookbackDays * dayMs);
        const boundedStartTime = Math.max(earliestAllowedTime, requestedStartTime);
        
        const fetchCategory = async (category: string) => {
            let categoryTrades: any[] = [];
            for (let endTime = now; endTime > boundedStartTime; endTime -= sevenDaysMs) {
                const safeEndTime = Math.max(endTime, boundedStartTime);
                const startTime = Math.max(boundedStartTime, safeEndTime - sevenDaysMs);
                let cursor = '';
                const seenCursors = new Set<string>();
                
                while (true) {
                    const params: any = {
                        category,
                        limit: '100',
                        startTime: startTime.toString(),
                        endTime: safeEndTime.toString()
                    };
                    if (cursor) {
                        params.cursor = cursor;
                        if (seenCursors.has(cursor)) break;
                        seenCursors.add(cursor);
                    }
                    
                    const data = await fetchFromBybit('/position/closed-pnl', params);
                    
                    if (data?.error && safeEndTime === now && !cursor) {
                        return { error: data.error, details: data.details };
                    }
                    
                    if (data?.result?.list && data.result.list.length > 0) {
                        categoryTrades = [...categoryTrades, ...data.result.list];
                        cursor = data.result.nextPageCursor;
                        if (!cursor) break; // No more pages in this window
                    } else {
                        break; // No trades in this window or page
                    }
                }
            }
            return { list: categoryTrades };
        };

        const [linearResult, inverseResult] = await Promise.all([
            fetchCategory('linear'),
            fetchCategory('inverse')
        ]);
        
        const firstError = [linearResult, inverseResult].find((result: any) => result?.error);
        if (firstError && !(linearResult.list?.length || inverseResult.list?.length)) {
            return res.status(400).json({ success: false, error: firstError.error, details: firstError.details });
        }
        
        const dedupeMap = new Map<string, any>();
        [...(linearResult.list || []), ...(inverseResult.list || [])].forEach((trade: any) => {
            const key = `${trade.symbol || ''}-${trade.orderId || ''}-${trade.updatedTime || ''}-${trade.side || ''}-${trade.closedPnl || ''}`;
            if (!dedupeMap.has(key)) {
                dedupeMap.set(key, trade);
            }
        });

        const allTrades = [...dedupeMap.values()]
            .sort((a,b) => parseInt(b.updatedTime) - parseInt(a.updatedTime));
            
        res.json({ success: true, list: allTrades });
    } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get("/api/bybit/wallet-balance", async (req, res) => {
    try {
        let data = await fetchFromBybit('/account/wallet-balance', { accountType: 'UNIFIED', coin: 'USDT' });
        if (data?.error || !data?.result?.list?.length) {
            data = await fetchFromBybit('/account/wallet-balance', { accountType: 'CONTRACT', coin: 'USDT' });
        }
        if (data?.error) {
            return res.status(400).json({ success: false, error: data.error, details: data.details });
        }
        res.json({ success: true, data: data?.result?.list?.[0] || null });
    } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get("/api/bybit/executions", async (req, res) => {
    try {
        const data = await fetchFromBybit('/execution/list', { category: 'linear', limit: '20' });
        if (data?.error) {
            return res.status(400).json({ success: false, error: data.error, details: data.details });
        }
        res.json({ success: true, list: data?.result?.list || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
    }
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
      // Create a pending deposit record in Firestore using Admin SDK
      try {
        console.log(`Attempting write to database: ${dbId} using Admin SDK`);
        await adminFirestore.collection('deposits').doc(orderId).set({
          userId,
          userEmail,
          totalAmount: amountNum,
          investedAmount,
          status: 'PENDING',
          currency: currency || 'ltc',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Update user's pendingInvested
        const userRef = adminFirestore.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (userDoc.exists) {
          const currentPending = userDoc.data()?.pendingInvested || 0;
          await userRef.update({
            pendingInvested: currentPending + investedAmount
          });
        }

        console.log("Deposit record and pending amount updated successfully via Admin SDK.");
      } catch (dbError: any) {
        console.error(`Firestore write failed for database ${dbId} via Admin SDK:`, dbError.message);
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
        const depositRef = adminFirestore.collection('deposits').doc(order_id);
        const depositDoc = await depositRef.get();

        if (depositDoc.exists && depositDoc.data()?.status === 'PENDING') {
          const data = depositDoc.data()!;
          const userId = data.userId;
          const investedAmount = data.investedAmount;

          // Mark deposit as completed
          await depositRef.update({
            status: 'COMPLETED',
            actuallyPaid: actually_paid,
            completedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Update user's totalInvested and pendingInvested
          const userRef = adminFirestore.collection('users').doc(userId);
          const userDoc = await userRef.get();
          
          if (userDoc.exists) {
            const currentTotal = userDoc.data()?.totalInvested || 0;
            const currentPending = userDoc.data()?.pendingInvested || 0;
            
            await userRef.update({
              totalInvested: currentTotal + investedAmount,
              pendingInvested: Math.max(0, currentPending - investedAmount)
            });
          }
        }
      } else if (payment_status === 'failed' || payment_status === 'expired') {
        const depositRef = adminFirestore.collection('deposits').doc(order_id);
        const depositDoc = await depositRef.get();

        if (depositDoc.exists && depositDoc.data()?.status === 'PENDING') {
          const data = depositDoc.data()!;
          const userId = data.userId;
          const investedAmount = data.investedAmount;

          // Mark deposit as failed
          await depositRef.update({
            status: 'FAILED',
            completedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Update user's pendingInvested
          const userRef = adminFirestore.collection('users').doc(userId);
          const userDoc = await userRef.get();
          
          if (userDoc.exists) {
            const currentPending = userDoc.data()?.pendingInvested || 0;
            await userRef.update({
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
        console.log(`[${timestamp}] Content snippet: "${content.substring(0, 100)}..."`);

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
