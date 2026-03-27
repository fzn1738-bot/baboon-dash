import CryptoJS from 'crypto-js';
import { BybitPosition, BybitClosedPnL } from '../types';

const API_KEY = '29xmZ8cxeGVcFNyFtq';
const API_SECRET = 'mxMiECJPSLU9PPuxPInROcVt0j0IB6r5BFo2';
const RECV_WINDOW = 10000; 

const BASE_URL = 'https://api.bybit.com';

export interface ApiLog {
    timestamp: string;
    method: string;
    url: string;
    status: number;
    data?: any;
    error?: string;
}

export let apiLogs: ApiLog[] = [];

const addLog = (log: ApiLog) => {
    apiLogs = [log, ...apiLogs].slice(0, 50); // Keep last 50 logs
};

const generateSignature = (timestamp: number, queryString: string) => {
    const preHash = timestamp.toString() + API_KEY + RECV_WINDOW.toString() + queryString;
    return CryptoJS.HmacSHA256(preHash, API_SECRET).toString(CryptoJS.enc.Hex);
};

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
    
    const headers = {
        'X-BAPI-API-KEY': API_KEY,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': RECV_WINDOW.toString(),
        'Content-Type': 'application/json',
    };

    // 1. Attempt using the Vite/Nginx local proxy first (best for avoiding CORS)
    const url = `/v5${endpoint}?${queryString}`;
    let response;

    console.log(`[Bybit API] Fetching: ${url}`);
    try {
        response = await fetch(url, { method: 'GET', headers });
        console.log(`[Bybit API] Local proxy response status: ${response.status}`);
        
        // Log successful proxy call
        addLog({
            timestamp: new Date().toLocaleTimeString(),
            method: 'GET',
            url: url,
            status: response.status
        });
    } catch (localError) {
        console.warn("[Bybit API] Local proxy failed or not available. Switching to public CORS proxy...");
        addLog({
            timestamp: new Date().toLocaleTimeString(),
            method: 'GET',
            url: url,
            status: 0,
            error: 'Local proxy failed'
        });
        response = null;
    }

    // 2. If local proxy 404s, 403s (geo-blocked), or fails, fallback to public CORS proxy
    if (!response || response.status === 404 || response.status === 403) {
        try {
            const directUrl = `${BASE_URL}/v5${endpoint}?${queryString}`;
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(directUrl)}`;
            console.log(`[Bybit API] Falling back to public proxy: ${proxyUrl}`);
            response = await fetch(proxyUrl, { method: 'GET', headers });
            console.log(`[Bybit API] Public proxy response status: ${response.status}`);
            
            addLog({
                timestamp: new Date().toLocaleTimeString(),
                method: 'GET',
                url: proxyUrl,
                status: response.status
            });
        } catch (proxyError) {
            console.error("[Bybit API] Public proxy fallback also failed due to network/CORS error.", proxyError);
            addLog({
                timestamp: new Date().toLocaleTimeString(),
                method: 'GET',
                url: `${BASE_URL}/v5${endpoint}?${queryString}`,
                status: 0,
                error: 'Public proxy fallback failed'
            });
            return null;
        }
    }

    // 3. Handle API responses
    if (!response.ok) {
        const text = await response.text();
        if (response.status === 403) {
            console.error(`[Bybit API] 403 Forbidden. Geo-Blocked (US IP) OR Invalid API Key. Details: ${text.substring(0, 100)}`);
        } else {
            console.error(`[Bybit API] Error ${response.status}: ${text.substring(0, 100)}...`);
        }
        return null; 
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
        const data = await response.json();
        if (data.retCode !== 0) {
            console.error(`[Bybit API] Logic Error [${data.retCode}]:`, data.retMsg);
            return null; // Don't return faulty data
        }
        return data;
    } else {
        console.error("[Bybit API] Response was not JSON format. Usually indicates a firewall or proxy page."); 
        return null;
    }
};

export const fetchBybitPositions = async (): Promise<BybitPosition[]> => {
    const params = {
        category: 'linear',
        settleCoin: 'USDT', 
    };
    
    const data = await fetchBybit('/position/list', params);
    return data?.result?.list || [];
};

export const fetchClosedPnL = async (): Promise<BybitClosedPnL[]> => {
    let allTrades: BybitClosedPnL[] = [];
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    try {
        // Fetch up to 12 months for performance reasons
        for (let i = 0; i < 12; i++) { 
            const endTime = now - (i * thirtyDaysMs);
            const startTime = endTime - thirtyDaysMs;
            
            const params: Record<string, string> = {
                category: 'linear',
                symbol: 'BTCUSDT', 
                limit: '50',
                startTime: startTime.toString(),
                endTime: endTime.toString()
            };
            
            const data = await fetchBybit('/position/closed-pnl', params);
            
            if (data?.result?.list && data.result.list.length > 0) {
                allTrades = [...allTrades, ...data.result.list];
            } else {
                // Break early if no trades in this 30-day chunk
                break;
            }
        }
    } catch (e) {
        console.error("Pagination Error fetching closed PnL", e);
    }

    return allTrades.sort((a,b) => parseInt(b.updatedTime) - parseInt(a.updatedTime));
};

export const fetchWalletBalance = async (): Promise<number> => {
    const params = {
        accountType: 'UNIFIED',
        coin: 'USDT'
    };
    
    const data = await fetchBybit('/account/wallet-balance', params);
    
    if (data?.result?.list?.[0]) {
        const accountData = data.result.list[0];
        
        // Prefer 'totalEquity' for the entire UTA
        if (accountData.totalEquity) {
            return parseFloat(accountData.totalEquity);
        }
        
        // Fallback to specific USDT coin object
        if (accountData.coin && accountData.coin.length > 0) {
            const usdtData = accountData.coin.find((c: any) => c.coin === 'USDT') || accountData.coin[0];
            return parseFloat(usdtData.equity || usdtData.walletBalance) || 0;
        }
    }
    
    return 0; 
};

export const fetchRecentExecutions = async (): Promise<any[]> => {
    const params = {
        category: 'linear',
        symbol: 'BTCUSDT', 
        limit: '20', 
    };
    
    const data = await fetchBybit('/execution/list', params);
    return data?.result?.list || [];
};
