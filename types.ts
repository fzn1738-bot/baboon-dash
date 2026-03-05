import React from 'react';

export type UserRole = 'INVESTOR' | 'ADMIN';

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  TRADES = 'TRADES',
  CALCULATOR = 'CALCULATOR',
  USERS = 'USERS',
  SETTINGS = 'SETTINGS',
}

export type Timeframe = '1H' | '2H' | '4H' | '1D';
export type AssetType = 'CRYPTO' | 'STOCK';

export interface Asset {
  symbol: string;
  name: string;
  type: AssetType;
  price: number;
  change: number;
}

export interface Trade {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  amount: number;
  price: number;
  status: 'OPEN' | 'CLOSED' | 'PENDING';
  date: string;
  pnl?: number; // Profit/Loss for closed trades
  userId: string; // For admin view
  strategySignal?: string; // e.g., "CORE_LONG", "CTF_FALLBACK"
}

export interface User {
  id: string;
  name: string;
  email: string;
  ltcAddress: string;
  totalInvested: number;
  feesPaidYTD: number;
  profitsPaidTotal: number;
  lastQuarterPayout: number;
  rolloverEnabled: boolean;
}

export interface NavItem {
  id: AppView;
  label: string;
  icon: React.ReactNode;
}

export interface StatMetric {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
}

export interface UserInvestment {
  username: string;
  invested: number;
  joinDate: string;
  status: 'Active' | 'Pending';
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isError?: boolean;
}

// Bybit Specific Types
export interface BybitPosition {
  symbol: string;
  side: string; // 'Buy' or 'Sell' or 'None'
  size: string;
  avgPrice: string;
  unrealisedPnl: string;
  cumRealisedPnl: string;
  positionValue: string;
  markPrice: string;
}

export interface BybitClosedPnL {
  symbol: string;
  orderId: string;
  side: string;
  qty: string;
  orderPrice: string;
  orderType: string;
  execType: string;
  closedPnl: string;
  cumEntryValue: string;
  avgEntryPrice: string;
  avgExitPrice: string;
  closedSize: string;
  fillCount: string;
  leverage: string;
  createdTime: string;
  updatedTime: string;
}