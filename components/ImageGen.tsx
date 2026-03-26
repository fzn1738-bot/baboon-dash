import React, { useState } from 'react';
import { Palette, Sparkles, Download, Loader2 } from 'lucide-react';
import { generateCreativeImage } from '../services/gemini';

export const ImageGen: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsLoading(true);
    setError(null);
    setGeneratedImage(null);

    try {
      const imageUrl = await generateCreativeImage(prompt);
      setGeneratedImage(imageUrl);
    } catch (err) {
      setError("The art monkeys dropped their brushes. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold text-white flex items-center justify-center gap-3">
          <Palette className="text-purple-400" size={32} /> Banana Art Studio
        </h2>
        <p className="text-slate-400">Describe your masterpiece and watch Baboon Dash paint it.</p>
      </div>

      <div className="bg-slate-800/50 backdrop-blur border border-slate-700 p-2 rounded-2xl flex gap-2 shadow-xl">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A futuristic baboon city in the clouds, cyberpunk style..."
          className="flex-1 bg-transparent text-white px-4 py-3 focus:outline-none placeholder-slate-500"
          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
        />
        <button
          onClick={handleGenerate}
          disabled={isLoading || !prompt.trim()}
          className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-6 py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg hover:shadow-purple-500/25"
        >
          {isLoading ? <Loader2 className="animate-spin" /> : <Sparkles size={20} />}
          <span className="hidden sm:inline">Generate</span>
        </button>
      </div>

      <div className="flex justify-center">
        <div className={`
          relative w-full max-w-lg aspect-square bg-slate-900 rounded-2xl overflow-hidden border-2 border-slate-800 flex items-center justify-center
          ${isLoading ? 'animate-pulse' : ''}
        `}>
          {isLoading && (
            <div className="text-center space-y-4">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 border-4 border-slate-700 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-purple-500 rounded-full border-t-transparent animate-spin"></div>
              </div>
              <p className="text-purple-300 font-medium">Mixing colors...</p>
            </div>
          )}

          {!isLoading && !generatedImage && !error && (
            <div className="text-center text-slate-600 p-8">
              <Palette size={48} className="mx-auto mb-4 opacity-20" />
              <p>Your canvas is empty</p>
            </div>
          )}

          {error && (
            <div className="text-red-400 text-center p-8 bg-red-900/10 rounded-xl">
              <p>{error}</p>
            </div>
          )}

          {generatedImage && !isLoading && (
            <div className="relative group w-full h-full">
              <img 
                src={generatedImage} 
                alt="Generated Art" 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                <a 
                  href={generatedImage} 
                  download={`baboon-art-${Date.now()}.png`}
                  className="p-3 bg-white text-slate-900 rounded-full hover:bg-yellow-400 transition-colors transform hover:scale-110"
                >
                  <Download size={24} />
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};