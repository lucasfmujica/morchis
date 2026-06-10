'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';

interface Msg { role: 'user' | 'assistant'; content: string }

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    const history = messages.slice(-6);
    setMessages((m) => [...m, { role: 'user', content: q }]);
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
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Uy, no pude responder eso ahora. Probá de nuevo en un ratito.' }]);
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
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-snug whitespace-pre-wrap"
                style={m.role === 'user'
                  ? { background: '#7EC8A4', color: '#FFFFFF', borderBottomRightRadius: 6 }
                  : { background: '#FFFFFF', color: '#2D2D2D', borderBottomLeftRadius: 6 }}
              >
                <Rich text={m.content} />
              </div>
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribí tu pregunta…"
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
