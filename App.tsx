import React, { useState, useRef, useEffect } from 'react';
import { useLiveApi } from './hooks/useLiveApi';
import Visualizer from './components/Visualizer';
import { GoogleGenAI } from '@google/genai';
import { Mic, MicOff, FileText, Loader2, Sparkles, StopCircle, RefreshCw, PenTool } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function App() {
  const { isConnected, isListening, volume, transcripts, connect, disconnect, toggleMute, error } = useLiveApi();
  const [article, setArticle] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcripts]);

  const generateArticle = async () => {
    if (transcripts.length === 0) return;
    
    setIsGenerating(true);
    // Disconnect live session to free up resources and focus on generation
    if (isConnected) {
        disconnect();
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const conversationText = transcripts
        .map(t => `${t.role.toUpperCase()}: ${t.text}`)
        .join('\n\n');

      const prompt = `You are a professional editor. Based on the following brainstorming session transcript, write a comprehensive, engaging, and well-structured article. Use Markdown formatting.
      
      TRANSCRIPT:
      ${conversationText}
      
      ARTICLE:`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      setArticle(response.text || "Failed to generate article.");
    } catch (e: any) {
      console.error(e);
      setArticle(`Error generating article: ${e.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const reset = () => {
    setArticle(null);
    disconnect();
    // Note: To clear transcripts in the hook, we'd need a reset function exposed, 
    // but for now disconnecting and reconnecting essentially starts a fresh session context in UI 
    // although the hook state might persist if we don't unmount. 
    // A full page reload is a simple way to clear everything in this demo structure.
    window.location.reload(); 
  };

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans selection:bg-indigo-500 selection:text-white">
      
      {/* Sidebar / Transcript Area */}
      <div className="w-1/3 border-r border-gray-800 flex flex-col bg-gray-950">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-cyan-400">
            <Sparkles size={18} />
            Brainstorming
          </h2>
          <span className={`text-xs px-2 py-1 rounded-full ${isConnected ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'}`}>
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        
        <div ref={transcriptContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {transcripts.length === 0 && (
            <div className="text-gray-500 text-center mt-10 text-sm">
              <p>Connect and start speaking to brainstorm your article ideas.</p>
            </div>
          )}
          {transcripts.map((t, i) => (
            <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                t.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-tr-none' 
                  : 'bg-gray-800 text-gray-200 rounded-tl-none border border-gray-700'
              }`}>
                {t.text}
              </div>
              <span className="text-[10px] text-gray-500 mt-1 px-1">
                {t.role === 'user' ? 'You' : 'Gemini'}
              </span>
            </div>
          ))}
          {/* Invisible padding for scroll */}
          <div className="h-4"></div>
        </div>

        {/* Live Controls */}
        <div className="p-6 bg-gray-900 border-t border-gray-800">
           {error && (
             <div className="mb-4 p-2 bg-red-900/30 border border-red-800 rounded text-red-200 text-xs text-center">
               {error}
             </div>
           )}

           {!isConnected ? (
             <button
                onClick={connect}
                className="w-full py-4 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 rounded-xl font-medium shadow-lg shadow-indigo-900/20 transition-all active:scale-95 flex items-center justify-center gap-2"
             >
                <Mic size={20} />
                Start Session
             </button>
           ) : (
             <div className="flex flex-col gap-4">
                <div className="flex items-center justify-center">
                    <Visualizer isActive={true} volume={volume} />
                </div>
                
                <div className="flex gap-3">
                    <button
                        onClick={toggleMute}
                        className={`flex-1 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                            isListening 
                            ? 'bg-gray-800 hover:bg-gray-700 text-white' 
                            : 'bg-red-900/50 text-red-200 border border-red-800'
                        }`}
                    >
                        {isListening ? <><Mic size={18} /> Mute</> : <><MicOff size={18} /> Muted</>}
                    </button>
                    <button
                        onClick={disconnect}
                        className="flex-1 py-3 bg-gray-800 hover:bg-red-900/30 hover:text-red-200 hover:border-red-900 border border-transparent rounded-lg font-medium transition-all flex items-center justify-center gap-2"
                    >
                        <StopCircle size={18} />
                        End
                    </button>
                </div>
             </div>
           )}
        </div>
      </div>

      {/* Main Content / Article Area */}
      <div className="w-2/3 flex flex-col bg-gray-900 relative">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 backdrop-blur-md absolute w-full top-0 z-10">
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-indigo-400">
                Article Generator
            </h1>
            <div className="flex gap-2">
                {article && (
                    <button 
                        onClick={reset}
                        className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors flex items-center gap-1"
                    >
                        <RefreshCw size={14} /> New Session
                    </button>
                )}
            </div>
        </div>

        <div className="flex-1 overflow-y-auto p-10 pt-20">
            {!article && !isGenerating && (
                <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-4">
                    <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                        <PenTool size={32} className="text-gray-500" />
                    </div>
                    <p className="text-lg font-medium text-gray-400">Ready to write?</p>
                    <p className="max-w-md text-center text-sm">
                        1. Connect to Gemini Live on the left.<br/>
                        2. Brainstorm your topic verbally.<br/>
                        3. Click "Generate Article" when you're ready.
                    </p>
                    
                    <button
                        disabled={transcripts.length < 2}
                        onClick={generateArticle}
                        className={`mt-8 px-8 py-3 rounded-full font-bold transition-all flex items-center gap-2 ${
                            transcripts.length < 2 
                            ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                            : 'bg-white text-black hover:bg-cyan-50 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)]'
                        }`}
                    >
                        <FileText size={20} />
                        Generate Article
                    </button>
                    {transcripts.length > 0 && transcripts.length < 2 && (
                         <p className="text-xs text-gray-500 animate-pulse">Speak a bit more to generate...</p>
                    )}
                </div>
            )}

            {isGenerating && (
                <div className="h-full flex flex-col items-center justify-center space-y-6">
                    <Loader2 size={48} className="animate-spin text-cyan-400" />
                    <p className="text-xl font-light text-gray-300">Drafting your article...</p>
                    <div className="text-sm text-gray-500 max-w-sm text-center">
                        Analyzing transcript, structuring arguments, and polishing prose.
                    </div>
                </div>
            )}

            {article && (
                <div className="max-w-3xl mx-auto prose prose-invert prose-lg prose-indigo">
                    <ReactMarkdown>{article}</ReactMarkdown>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}