import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, RefreshCw } from 'lucide-react';
import { sendChatMessage } from '../services/gemini';
import { Message } from '../types';
import ReactMarkdown from 'react-markdown';

export const Chat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: "Ooh-ooh-ah-ah! Welcome to the troop. I'm the Baboon Dash AI. How can we get creative today?", timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', text: input, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Convert current messages to history format if needed, but for this simple demo, 
      // we'll let the model maintain context or just send the new message if the API wrapper handles session.
      // The service implementation creates a new chat each time for simplicity in this stateless example,
      // but in a real app you'd maintain the `ChatSession` object.
      // We will pass simplified history for better context.
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const responseText = await sendChatMessage(userMsg.text, history);
      
      const botMsg: Message = { role: 'model', text: responseText, timestamp: new Date() };
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', text: "Use text only for this chat, or try again later. The jungle wifi is spotty.", timestamp: new Date(), isError: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] md:h-full max-w-4xl mx-auto">
      <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl shadow-xl flex-1 flex flex-col overflow-hidden border border-slate-700">
        {/* Header */}
        <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Bot className="text-yellow-400" /> The Troop Chat
          </h2>
          <button 
            onClick={() => setMessages([messages[0]])}
            className="text-slate-400 hover:text-white transition-colors text-sm flex items-center gap-1"
          >
            <RefreshCw size={14} /> Reset
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center shrink-0
                ${msg.role === 'user' ? 'bg-indigo-500' : 'bg-yellow-400'}
              `}>
                {msg.role === 'user' ? <User size={16} className="text-white" /> : <Bot size={16} className="text-slate-900" />}
              </div>
              
              <div className={`
                max-w-[80%] rounded-2xl px-5 py-3 shadow-sm
                ${msg.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-tr-sm' 
                  : 'bg-slate-700 text-slate-100 rounded-tl-sm'
                }
                ${msg.isError ? 'bg-red-900/50 border border-red-500' : ''}
              `}>
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                <div className="text-[10px] opacity-50 mt-2 text-right">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center animate-pulse">
                <Bot size={16} className="text-slate-900" />
              </div>
              <div className="bg-slate-700 rounded-2xl rounded-tl-sm px-5 py-4 flex items-center gap-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 bg-slate-900/80 border-t border-slate-700">
          <div className="flex gap-2 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message to the Chief..."
              className="w-full bg-slate-800 text-white placeholder-slate-400 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-yellow-400/50 border border-slate-700 resize-none h-14"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="absolute right-2 top-2 p-2 bg-yellow-400 text-slate-900 rounded-lg hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-yellow-400/20"
            >
              <Send size={20} />
            </button>
          </div>
          <div className="text-center mt-2 text-xs text-slate-500">
            Baboon Dash AI can make mistakes. Check important info.
          </div>
        </div>
      </div>
    </div>
  );
};