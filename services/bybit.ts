import { BybitPosition, BybitClosedPnL } from '../types';

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

const fetchFromBackend = async (endpoint: string) => {
    const url = `/api/bybit${endpoint}`;
    try {
        const response = await fetch(url);
        addLog({
            timestamp: new Date().toLocaleTimeString(),
            method: 'GET',
            url: url,
            status: response.status
        });
        
        if (!response.ok) {
            const text = await response.text();
            console.error(`[Bybit Frontend] Error ${response.status}: ${text}`);
            if (apiLogs.length > 0) {
                apiLogs[0].error = `HTTP ${response.status}: ${text}`;
            }
            return null;
        }
        
        const data = await response.json();
        if (!data.success) {
            console.error(`[Bybit Frontend] Backend Error:`, data.error);
            if (apiLogs.length > 0) {
                apiLogs[0].error = data.error;
            }
            return null;
        }
        
        return data;
    } catch (error) {
        console.error("[Bybit Frontend] Network error:", error);
        addLog({
            timestamp: new Date().toLocaleTimeString(),
            method: 'GET',
            url: url,
            status: 0,
            error: String(error)
        });
        return null;
    }
};

export const fetchBybitPositions = async (): Promise<BybitPosition[]> => {
    try {
        console.log("[Bybit Frontend] Fetching positions from backend...");
        const data = await fetchFromBackend('/positions');
        const allPositions = data?.list || [];
        
        const activePositions = allPositions.filter((p: any) => parseFloat(p.size) !== 0 || parseFloat(p.positionValue) !== 0);
        
        if (activePositions.length > 0) {
            console.log(`[Bybit Frontend] Found ${activePositions.length} active positions:`, 
                activePositions.map((p: any) => `${p.symbol} (${p.side}) - Size: ${p.size}`));
        } else {
            console.log(`[Bybit Frontend] No active positions found.`);
        }
        
        return allPositions;
    } catch (error) {
        console.error("[Bybit Frontend] Error in fetchBybitPositions:", error);
        return [];
    }
};

export const fetchClosedPnL = async (symbol?: string): Promise<BybitClosedPnL[]> => {
    try {
        console.log("[Bybit Frontend] Fetching closed PnL from backend...");
        const data = await fetchFromBackend('/closed-pnl');
        let trades = data?.list || [];
        
        if (symbol) {
            trades = trades.filter((t: any) => t.symbol === symbol);
        }
        
        return trades;
    } catch (error) {
        console.error("[Bybit Frontend] Error in fetchClosedPnL:", error);
        return [];
    }
};

export const fetchWalletBalance = async (): Promise<number> => {
    try {
        console.log("[Bybit Frontend] Fetching wallet balance from backend...");
        const data = await fetchFromBackend('/wallet-balance');
        const balanceData = data?.data;
        
        if (balanceData && balanceData.coin && balanceData.coin.length > 0) {
            const usdtCoin = balanceData.coin.find((c: any) => c.coin === 'USDT');
            if (usdtCoin) {
                return parseFloat(usdtCoin.walletBalance) || 0;
            }
        }
        return 0;
    } catch (error) {
        console.error("[Bybit Frontend] Error in fetchWalletBalance:", error);
        return 0;
    }
};

export const fetchRecentExecutions = async (): Promise<any[]> => {
    try {
        console.log("[Bybit Frontend] Fetching recent executions from backend...");
        const data = await fetchFromBackend('/executions');
        return data?.list || [];
    } catch (error) {
        console.error("[Bybit Frontend] Error in fetchRecentExecutions:", error);
        return [];
    }
};
