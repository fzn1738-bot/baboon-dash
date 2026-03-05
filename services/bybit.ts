import CryptoJS from 'crypto-js';
import { BybitPosition, BybitClosedPnL } from '../types';

const API_KEY = '29xmZ8cxeGVcFNyFtq';
const API_SECRET = 'mxMiECJPSLU9PPuxPInROcVt0j0IB6r5BFo2';
const RECV_WINDOW = 10000; // Increased window for better reliability

// Use /api prefix to trigger proxy, preventing 404s on static file lookups
const BASE_URL = '/api/v5'; 

const generateSignature = (timestamp: number, queryString: string) => {
    // Bybit V5: timestamp + key + recv_window + queryString
    const preHash = timestamp.toString() + API_KEY + RECV_WINDOW.toString() + queryString;
    return CryptoJS.HmacSHA256(preHash, API_SECRET).toString(CryptoJS.enc.Hex);
};

// Helper to sort keys and encode params consistently for both URL and Signature
const buildQueryString = (params: Record<string, string>) => {
    const keys = Object.keys(params).sort();
    const searchParams = new URLSearchParams();
    keys.forEach(key => searchParams.append(key, params[key]));
    return searchParams.toString();
};

const fetchBybit = async (endpoint: string, params: Record<string, string>) => {
    const timestamp = Date.now();
    const queryString = buildQueryString(params);
    const signature = generateSignature(timestamp, queryString);
    
    const url = `${BASE_URL}${endpoint}?${queryString}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-BAPI-API-KEY': API_KEY,
                'X-BAPI-TIMESTAMP': timestamp.toString(),
                'X-BAPI-SIGN': signature,
                'X-BAPI-RECV-WINDOW': RECV_WINDOW.toString(),
                'Content-Type': 'application/json',
            }
        });

        const contentType = response.headers.get("content-type");
        
        if (!response.ok) {
            const text = await response.text();
            console.error(`Bybit API Error (${response.status}):`, text);
            return null;
        }

        if (contentType && contentType.indexOf("application/json") !== -1) {
             const data = await response.json();
             if (data.retCode !== 0) {
                 console.warn(`Bybit Logic Error [${data.retCode}]:`, data.retMsg);
             }
             return data;
        } else {
            const text = await response.text();
            console.error("Bybit Response Not JSON:", text.substring(0, 100));
            return null;
        }

    } catch (error) {
        console.error("Bybit Fetch Exception:", error);
        return null;
    }
};

export const fetchBybitPositions = async (): Promise<BybitPosition[]> => {
    const params = {
        category: 'linear',
        symbol: 'BTCUSDT',
    };
    
    const data = await fetchBybit('/position/list', params);
    if (data && data.result?.list) {
        return data.result.list;
    }
    return [];
};

export const fetchClosedPnL = async (): Promise<BybitClosedPnL[]> => {
    let allTrades: BybitClosedPnL[] = [];
    let cursor = '';
    let pageCount = 0;
    const MAX_PAGES = 15;

    try {
        do {
            const params: Record<string, string> = {
                category: 'linear',
                limit: '50',
            };
            
            if (cursor) {
                params.cursor = cursor;
            }

            const data = await fetchBybit('/position/closed-pnl', params);
            
            if (data && data.result?.list) {
                allTrades = [...allTrades, ...data.result.list];
                cursor = data.result.nextPageCursor || '';
            } else {
                break;
            }
            
            pageCount++;
        } while (cursor && pageCount < MAX_PAGES);
        
        return allTrades;
    } catch (e) {
        console.error("Pagination Error:", e);
        return allTrades;
    }
};

export const fetchWalletBalance = async (): Promise<number> => {
    const params = {
        accountType: 'UNIFIED',
        coin: 'USDT'
    };
    
    const data = await fetchBybit('/account/wallet-balance', params);
    if (data && data.result?.list?.[0]?.coin?.[0]) {
        return parseFloat(data.result.list[0].coin[0].walletBalance) || 0;
    }
    return 0;
};

export const fetchRecentExecutions = async (): Promise<any[]> => {
    const params = {
        category: 'linear',
        limit: '20',
    };
    
    const data = await fetchBybit('/execution/list', params);
    if (data && data.result?.list) {
        return data.result.list;
    }
    return [];
};