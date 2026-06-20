'use client';

import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Account {
  id: string;
  name: string;
  type: string;
}

interface Statement {
  id: string;
  status: string;
  created_at: string;
  account_id: string | null;
  file_path: string | null;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  uploaded: { label: 'Subido', color: '#6B6459', bg: '#ECE5DC', icon: '📄' },
  parsing: { label: 'Analizando…', color: '#5BA886', bg: '#E4F2EA', icon: '⚙️' },
  parsed: { label: 'Listo', color: '#5BA886', bg: '#E4F2EA', icon: '✅' },
  failed: { label: 'Error', color: '#E5604C', bg: '#FFE7E2', icon: '⚠️' },
};

export default function ExtractosClient({
  profile,
  accounts,
}: {
  profile: Profile;
  accounts: Account[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [uploading, setUploading] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id ?? '');

  const { data: statements = [] } = useQuery<Statement[]>({
    queryKey: ['statements', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('statements')
        .select('id, status, created_at, account_id, file_path')
        .eq('household_id', profile.household_id)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data ?? []) as Statement[];
    },
    refetchInterval: (query) => {
      // Poll while any statement is parsing
      const data = query.state.data ?? [];
      return data.some((s: Statement) => s.status === 'parsing') ? 3000 : false;
    },
  });

  async function handleFileSelect(file: File) {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'pdf';
      const statementId = crypto.randomUUID();
      const filePath = `${profile.household_id}/${statementId}.${ext}`;

      // Upload to storage
      const { error: uploadErr } = await supabase.storage
        .from('statements')
        .upload(filePath, file, { contentType: file.type, upsert: false });

      if (uploadErr) throw uploadErr;

      // Create statement record
      const { error: insertErr } = await supabase.from('statements').insert({
        id: statementId,
        household_id: profile.household_id,
        profile_id: profile.id,
        account_id: selectedAccountId || null,
        file_path: filePath,
        status: 'uploaded',
      });

      if (insertErr) throw insertErr;

      // Trigger parse-statement edge function
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/parse-statement`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ statement_id: statementId }),
        },
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Error al analizar');
      }

      await qc.invalidateQueries({ queryKey: ['statements'] });
      toast.success('Resumen subido — analizando con IA…');
      router.push(`/extractos/${statementId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al subir el resumen');
    } finally {
      setUploading(false);
    }
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4">
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>Extractos</h1>
        <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>Subí un resumen para importar movimientos — PDF, foto o CSV (ej: actividad de Mercado Pago)</p>
      </header>

      {/* Upload card */}
      <div className="mx-4 mb-4 rounded-3xl p-5" style={{ background: '#FFFFFF' }}>
        {accounts.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-bold mb-1.5" style={{ color: '#6B6459' }}>Cuenta</p>
            <div className="flex gap-2 flex-wrap">
              {accounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  className="px-3 py-1.5 rounded-full text-xs font-bold border"
                  style={{
                    background: selectedAccountId === acc.id ? '#2D2D2D' : 'transparent',
                    borderColor: selectedAccountId === acc.id ? '#2D2D2D' : '#ECE5DC',
                    color: selectedAccountId === acc.id ? '#FFFFFF' : '#6B6459',
                  }}
                >
                  {acc.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/heic,image/webp,text/csv,.csv"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
            e.target.value = '';
          }}
        />

        <div className="flex gap-3">
          <button
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.removeAttribute('capture');
                fileInputRef.current.click();
              }
            }}
            disabled={uploading}
            className="flex-1 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: '#E4F2EA', color: '#5BA886' }}
          >
            📄 Subir archivo
          </button>
          <button
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.setAttribute('capture', 'environment');
                fileInputRef.current.click();
              }
            }}
            disabled={uploading}
            className="flex-1 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: '#FF7F6B', color: '#FFFFFF' }}
          >
            📷 Sacar foto
          </button>
        </div>

        {uploading && (
          <p className="text-xs text-center mt-3 font-semibold" style={{ color: '#7EC8A4' }}>
            Subiendo y analizando con IA…
          </p>
        )}
      </div>

      {/* Statement history */}
      {statements.length > 0 && (
        <div className="px-4">
          <p className="text-sm font-black mb-3" style={{ color: '#2D2D2D' }}>Historial</p>
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF' }}>
            {statements.map((s, i) => {
              const badge = STATUS_LABELS[s.status] ?? STATUS_LABELS.uploaded;
              return (
                <button
                  key={s.id}
                  onClick={() => router.push(`/extractos/${s.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-[#F9F5F0] transition-colors"
                  style={{ borderTop: i > 0 ? '1px solid #ECE5DC' : 'none' }}
                >
                  <span
                    className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                    style={{ background: badge.bg }}
                  >
                    <span className={s.status === 'parsing' ? 'animate-spin' : ''}>{badge.icon}</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: '#2D2D2D' }}>
                      {accounts.find((a) => a.id === s.account_id)?.name ?? 'Sin cuenta'}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#6B6459' }}>
                      {fmtDate(s.created_at)}
                    </p>
                  </div>
                  <span
                    className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
                    style={{ background: badge.bg, color: badge.color }}
                  >
                    {badge.label}
                  </span>
                  <span className="text-base shrink-0" style={{ color: '#C4B9AE' }}>›</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {statements.length === 0 && !uploading && (
        <div className="text-center py-16 px-8">
          <p className="text-5xl mb-4">🧾</p>
          <p className="text-base font-bold" style={{ color: '#2D2D2D' }}>Ningún extracto todavía</p>
          <p className="text-sm mt-2" style={{ color: '#6B6459' }}>
            Subí tu resumen en PDF, foto o CSV (ej: actividad de Mercado Pago) — la IA extrae todos los movimientos para que los revisés.
          </p>
        </div>
      )}

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={[]}
        accounts={accounts}
      />
    </div>
  );
}
