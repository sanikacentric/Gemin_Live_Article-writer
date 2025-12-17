import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { base64ToBytes, decodeAudioData, createPcmBlob } from '../utils/audio';

interface TranscriptItem {
  role: 'user' | 'model';
  text: string;
  isPartial?: boolean;
}

interface UseLiveApiReturn {
  isConnected: boolean;
  isListening: boolean;
  volume: number;
  transcripts: TranscriptItem[];
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  error: string | null;
}

export function useLiveApi(): UseLiveApiReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(true); // Default to listening when connected
  const [volume, setVolume] = useState(0);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Audio Contexts & Nodes
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // API Session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);

  // State refs for access inside closures
  const transcriptsRef = useRef<TranscriptItem[]>([]);
  const currentInputTransRef = useRef('');
  const currentOutputTransRef = useRef('');

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  const cleanupAudio = useCallback(() => {
    if (inputProcessorRef.current) {
      inputProcessorRef.current.disconnect();
      inputProcessorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }
    activeSourcesRef.current.forEach(source => source.stop());
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const disconnect = useCallback(() => {
    if (disconnectRef.current) {
      // There isn't a direct disconnect method exposed on the session object easily in the type defs
      // provided, but we can close the connection by cleaning up the stream and contexts.
      // In a real WebSocket implementation, we'd close the socket.
      // The provided SDK doc says: "use session.close()".
      sessionPromiseRef.current?.then(session => {
         if(session && typeof session.close === 'function') {
             session.close();
         }
      }).catch(() => {}); // Ignore errors on close
    }
    
    cleanupAudio();
    setIsConnected(false);
    setVolume(0);
    sessionPromiseRef.current = null;
  }, [cleanupAudio]);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Initialize Audio Contexts
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Get Microphone Stream
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const inputCtx = inputContextRef.current;
      const outputCtx = outputContextRef.current;
      
      if (!inputCtx || !outputCtx) throw new Error("Could not initialize audio contexts");

      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);

      // Connect to Gemini Live
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are an expert ghostwriter and interviewer. Your goal is to help the user create a high-quality article. 
          
          1. Listen to the user's initial topic or thoughts.
          2. Ask probing, insightful questions to flesh out the details, structure, and tone.
          3. Keep your responses concise and conversational to encourage the user to speak more.
          4. Do not write the full article yet, just gather the content through conversation.`,
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            
            // Setup Input Processing
            const source = inputCtx.createMediaStreamSource(streamRef.current!);
            inputSourceRef.current = source;
            
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            inputProcessorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              if (!isListening) return; // Software mute

              const inputData = e.inputBuffer.getChannelData(0);
              
              // Simple volume meter
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i];
              }
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(Math.min(1, rms * 5)); // Amplify for visual

              const pcmBlob = createPcmBlob(inputData);
              sessionPromiseRef.current?.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const { serverContent } = msg;

            // Handle Transcriptions
            if (serverContent?.inputTranscription) {
                const text = serverContent.inputTranscription.text;
                if (text) {
                    currentInputTransRef.current += text;
                    // Update partial user transcript
                    setTranscripts(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'user' && last.isPartial) {
                            return [...prev.slice(0, -1), { role: 'user', text: currentInputTransRef.current, isPartial: true }];
                        }
                        return [...prev, { role: 'user', text: currentInputTransRef.current, isPartial: true }];
                    });
                }
            }

            if (serverContent?.outputTranscription) {
                const text = serverContent.outputTranscription.text;
                if (text) {
                    currentOutputTransRef.current += text;
                     // Update partial model transcript
                     setTranscripts(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'model' && last.isPartial) {
                            return [...prev.slice(0, -1), { role: 'model', text: currentOutputTransRef.current, isPartial: true }];
                        }
                         // If the previous was user (partial or complete), add new model
                         if (last && last.role === 'user') {
                            return [...prev, { role: 'model', text: currentOutputTransRef.current, isPartial: true }];
                         }
                         // If first message
                         if (prev.length === 0) {
                             return [{ role: 'model', text: currentOutputTransRef.current, isPartial: true }];
                         }
                         // Should not happen often but fallback
                        return [...prev, { role: 'model', text: currentOutputTransRef.current, isPartial: true }];
                    });
                }
            }

            // Turn Complete - Finalize transcripts
            if (serverContent?.turnComplete) {
                const finalInput = currentInputTransRef.current;
                const finalOutput = currentOutputTransRef.current;

                setTranscripts(prev => {
                    const newTranscripts = [...prev];
                    // Finalize the last partials
                    if (finalInput) {
                         // Find the partial user and make it complete
                         // Note: Logic here can be complex due to async, a simpler way is to just push the finalized strings if we clear the refs.
                         // But for smooth UI, we replace the partials.
                         const userIdx = newTranscripts.findIndex(t => t.role === 'user' && t.isPartial);
                         if (userIdx !== -1) newTranscripts[userIdx] = { role: 'user', text: finalInput };
                    }
                    if (finalOutput) {
                        const modelIdx = newTranscripts.findIndex(t => t.role === 'model' && t.isPartial);
                        if (modelIdx !== -1) newTranscripts[modelIdx] = { role: 'model', text: finalOutput };
                    }
                    return newTranscripts;
                });
                
                currentInputTransRef.current = '';
                currentOutputTransRef.current = '';
            }

            // Handle Audio Output
            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
               if (!outputContextRef.current) return;
               
               const ctx = outputContextRef.current;
               nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
               
               try {
                   const audioBuffer = await decodeAudioData(
                       base64ToBytes(base64Audio),
                       ctx,
                       24000,
                       1
                   );
                   
                   const source = ctx.createBufferSource();
                   source.buffer = audioBuffer;
                   source.connect(outputNode);
                   
                   source.addEventListener('ended', () => {
                       activeSourcesRef.current.delete(source);
                   });
                   
                   source.start(nextStartTimeRef.current);
                   nextStartTimeRef.current += audioBuffer.duration;
                   activeSourcesRef.current.add(source);
               } catch (e) {
                   console.error("Audio decode error", e);
               }
            }

            // Handle Interruption
            if (serverContent?.interrupted) {
                activeSourcesRef.current.forEach(s => s.stop());
                activeSourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                currentOutputTransRef.current = ''; // Clear partial output on interrupt
            }
          },
          onclose: () => {
            setIsConnected(false);
          },
          onerror: (e) => {
            console.error(e);
            setError("Connection error occurred.");
            setIsConnected(false);
          }
        }
      });

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to connect");
      cleanupAudio();
    }
  }, [isListening, cleanupAudio]);

  const toggleMute = useCallback(() => {
    setIsListening(prev => !prev);
  }, []);

  return {
    isConnected,
    isListening,
    volume,
    transcripts,
    connect,
    disconnect,
    toggleMute,
    error
  };
}