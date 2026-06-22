'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';

interface PendingAction { kind: string; payload: Record<string, unknown>; summary: string }
interface Msg { role: 'user' | 'assistant'; content: string; action?: PendingAction | null; suggestions?: string[] }

// Minimal shape of the Web Speech API we use for voice dictation.
interface SpeechRec {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
}

const SUGGESTIONS = [
  '¿Cuánto gastamos este mes y en qué se nos va más?',
  '¿Cuánto gastó cada uno este mes?',
  '¿Cuál es nuestro patrimonio neto y dónde tenemos más?',
  '¿En qué podríamos gastar menos?',
];

// Render the model's light markdown (**bold**) without a heavy dependency.
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export default function PreguntaleClient({ householdId, profileId }: { householdId: string; profileId: string }) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setMicSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // Voice dictation (es-AR): fills the input as you speak; tap again to stop.
  function toggleMic() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'es-AR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setInput(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    const history = messages.slice(-6);
    // Asking something new supersedes any still-open action card.
    setMessages((m) => [...m.map((msg) => (msg.action ? { ...msg, action: null } : msg)), { role: 'user', content: q }]);
    setInput('');
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMessages((m) => [...m, { role: 'assistant', content: 'Iniciá sesión de nuevo para que pueda responderte.' }]);
        return;
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ask-morchis`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history }),
      });
      const data = await res.json().catch(() => null);
      const answer = res.ok && data?.answer
        ? data.answer
        : 'Uy, no pude responder eso ahora. Probá de nuevo en un ratito.';
      setMessages((m) => [...m, { role: 'assistant', content: answer, action: (res.ok && data?.pending_action) || null, suggestions: (res.ok && data?.suggestions) || undefined }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Uy, no pude responder eso ahora. Probá de nuevo en un ratito.' }]);
    } finally {
      setLoading(false);
    }
  }

  // Execute a previewed action after the user taps "Confirmar".
  async function confirmAction(idx: number, action: PendingAction) {
    if (loading) return;
    setMessages((m) => m.map((msg, i) => (i === idx ? { ...msg, action: null } : msg)));
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMessages((m) => [...m, { role: 'assistant', content: 'Iniciá sesión de nuevo para confirmar.' }]);
        return;
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ask-morchis`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: action }),
      });
      const data = await res.json().catch(() => null);
      const answer = res.ok && data?.answer ? data.answer : 'Uy, no pude completar esa acción. Probá de nuevo.';
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Uy, no pude completar esa acción. Probá de nuevo.' }]);
    } finally {
      setLoading(false);
    }
  }

  function cancelAction(idx: number) {
    setMessages((m) => [...m.map((msg, i) => (i === idx ? { ...msg, action: null } : msg)), { role: 'assistant', content: 'Listo, no registré nada. 👍' }]);
  }

  // Photo of a receipt: upload → parse-receipt → propose the parsed expense as a
  // confirm card (reuses the same confirm flow as the write actions).
  async function handlePhoto(file: File) {
    if (loading) return;
    setMessages((m) => [...m.map((msg) => (msg.action ? { ...msg, action: null } : msg)), { role: 'user', content: '🧾 Te mandé un ticket' }]);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setMessages((m) => [...m, { role: 'assistant', content: 'Iniciá sesión de nuevo para leer el ticket.' }]); return; }
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${householdId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('statements').upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/parse-receipt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_paths: [path] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.receipt) throw new Error(data?.error || 'parse failed');
      const r = data.receipt as { merchant?: string; total: number; currency: string; items?: unknown[] };
      const cur = r.currency === 'USD' ? 'USD' : 'ARS';
      const amountTxt = cur === 'USD' ? `US$${Math.round(r.total)}` : `$${Math.round(r.total).toLocaleString('es-AR')}`;
      const nItems = Array.isArray(r.items) ? r.items.length : 0;
      const summary = `Gasto de ${amountTxt} en ${r.merchant || 'Compra'}${nItems ? ` (${nItems} ítems)` : ''}`;
      const action: PendingAction = { kind: 'record_receipt', payload: { receipt: { ...r, currency: cur } }, summary };
      setMessages((m) => [...m, { role: 'assistant', content: `Leí el ticket 🧾 — ${summary}. ¿Lo cargo?`, action }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Uy, no pude leer el ticket. Probá con una foto más nítida o cargalo a mano.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-3 shrink-0">
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Preguntale a Morchi ✨</h1>
        <p className="text-sm mt-0.5" style={{ color: '#6B6459' }}>Preguntá lo que quieras sobre su plata.</p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-44">
        {messages.length === 0 && !loading && (
          <div className="mt-2">
            <div className="rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
              <p className="text-3xl mb-2">👋</p>
              <p className="font-bold" style={{ color: '#2D2D2D' }}>Hola, soy Morchi</p>
              <p className="text-sm mt-1 leading-snug" style={{ color: '#6B6459' }}>
                Puedo consultar todos sus movimientos: gastos, ingresos, comercios, categorías, meses, saldos, presupuestos, metas y deudas. Probá con una de estas:
              </p>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="text-left text-sm font-semibold rounded-2xl px-4 py-3"
                  style={{ background: '#E4F2EA', color: '#5BA886', border: '1px solid #7EC8A4' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 mt-2">
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className="max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-snug whitespace-pre-wrap"
                style={m.role === 'user'
                  ? { background: '#7EC8A4', color: '#FFFFFF', borderBottomRightRadius: 6 }
                  : { background: '#FFFFFF', color: '#2D2D2D', borderBottomLeftRadius: 6 }}
              >
                <Rich text={m.content} />
              </div>
              {m.role === 'assistant' && m.action && (
                <div className="mt-2 max-w-[85%] rounded-2xl p-3" style={{ background: '#FFFFFF', border: '1px solid #ECE5DC' }}>
                  <p className="text-sm font-semibold" style={{ color: '#2D2D2D' }}>{m.action.summary}</p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      onClick={() => confirmAction(i, m.action!)}
                      disabled={loading}
                      className="flex-1 rounded-full py-2 text-sm font-bold text-white"
                      style={{ background: loading ? '#C4B9AE' : '#7EC8A4' }}
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => cancelAction(i)}
                      disabled={loading}
                      className="rounded-full px-4 py-2 text-sm font-semibold"
                      style={{ background: '#F2ECE4', color: '#6B6459' }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {m.role === 'assistant' && !m.action && m.suggestions && m.suggestions.length > 0 && i === messages.length - 1 && !loading && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold"
                      style={{ background: '#E4F2EA', color: '#5BA886', border: '1px solid #7EC8A4' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-3xl px-4 py-3 text-sm" style={{ background: '#FFFFFF', color: '#6B6459', borderBottomLeftRadius: 6 }}>
                Morchi está pensando…
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input bar, sitting just above the bottom nav */}
      <div
        className="fixed left-0 right-0 px-3 py-2 z-30"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 64px)', background: '#F9F5F0', borderTop: '1px solid #ECE5DC' }}
      >
        <form
          onSubmit={(e) => { e.preventDefault(); ask(input); }}
          className="flex items-center gap-2"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = ''; }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            aria-label="Mandar foto de un ticket"
            className="w-11 h-11 rounded-full text-lg flex items-center justify-center shrink-0"
            style={{ background: '#FFFFFF', color: '#6B6459', border: '1px solid #ECE5DC' }}
          >
            🧾
          </button>
          {micSupported && (
            <button
              type="button"
              onClick={toggleMic}
              aria-label={listening ? 'Detener dictado' : 'Dictar por voz'}
              className="w-11 h-11 rounded-full text-lg flex items-center justify-center shrink-0"
              style={listening
                ? { background: '#E0584F', color: '#FFFFFF', border: '1px solid #E0584F' }
                : { background: '#FFFFFF', color: '#6B6459', border: '1px solid #ECE5DC' }}
            >
              🎤
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? 'Escuchando…' : 'Escribí tu pregunta…'}
            enterKeyHint="send"
            className="flex-1 rounded-full px-4 py-3 text-sm outline-none"
            style={{ background: '#FFFFFF', border: '1px solid #ECE5DC', color: '#2D2D2D' }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-11 h-11 rounded-full text-xl text-white flex items-center justify-center shrink-0"
            style={{ background: loading || !input.trim() ? '#C4B9AE' : '#7EC8A4' }}
            aria-label="Enviar"
          >
            ↑
          </button>
        </form>
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={householdId}
        profileId={profileId}
        categories={[]}
        accounts={[]}
      />
    </div>
  );
}
