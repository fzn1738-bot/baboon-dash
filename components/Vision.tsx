import React, { useState, useRef } from 'react';
import { Upload, Eye, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { analyzeImage } from '../services/gemini';
import ReactMarkdown from 'react-markdown';

export const Vision: React.FC = () => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setResult(''); // Clear previous results
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedImage || !prompt.trim()) return;

    setIsLoading(true);
    try {
      const analysis = await analyzeImage(selectedImage, prompt);
      setResult(analysis);
    } catch (error) {
      setResult("Error analyzing image. Try a different jungle snapshot.");
    } finally {
      setIsLoading(false);
    }
  };

  const clearImage = () => {
    setSelectedImage(null);
    setResult('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center space-y-2 mb-8">
        <h2 className="text-3xl font-bold text-white flex items-center justify-center gap-3">
          <Eye className="text-green-400" size={32} /> Jungle Vision
        </h2>
        <p className="text-slate-400">Upload an image and ask the Chief to analyze it.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Input Section */}
        <div className="space-y-4">
          <div 
            className={`
              relative border-2 border-dashed rounded-2xl h-64 flex flex-col items-center justify-center transition-all cursor-pointer overflow-hidden
              ${selectedImage ? 'border-green-500/50 bg-slate-800' : 'border-slate-700 hover:border-yellow-400/50 hover:bg-slate-800/50'}
            `}
            onClick={() => !selectedImage && fileInputRef.current?.click()}
          >
            {selectedImage ? (
              <>
                <img src={selectedImage} alt="Preview" className="w-full h-full object-contain" />
                <button 
                  onClick={(e) => { e.stopPropagation(); clearImage(); }}
                  className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full hover:bg-red-500 transition-colors"
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <div className="text-center p-6">
                <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Upload className="text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-300">Click to upload</p>
                <p className="text-xs text-slate-500 mt-1">JPG, PNG up to 5MB</p>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleFileChange}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300 ml-1">What should I look for?</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., Describe the plants in this image..."
                className="flex-1 bg-slate-800 text-white border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-400/50"
              />
              <button
                onClick={handleAnalyze}
                disabled={!selectedImage || !prompt.trim() || isLoading}
                className="bg-green-500 hover:bg-green-400 text-slate-900 font-semibold px-6 py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                {isLoading ? <Loader2 className="animate-spin" /> : 'Analyze'}
              </button>
            </div>
          </div>
        </div>

        {/* Output Section */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 min-h-[16rem]">
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <ImageIcon size={16} /> Analysis Result
          </h3>
          
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
              <Loader2 className="animate-spin text-green-400" size={32} />
              <p className="text-sm animate-pulse">Scanning the jungle canopy...</p>
            </div>
          ) : result ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{result}</ReactMarkdown>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-600 italic">
              Results will appear here
            </div>
          )}
        </div>
      </div>
    </div>
  );
};