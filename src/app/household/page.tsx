'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type Step = 'choose' | 'create' | 'join' | 'profile';

export default function HouseholdPage() {
  const [step, setStep] = useState<Step>('choose');
  const [householdName, setHouseholdName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function createHousehold() {
    setLoading(true);
    try {
      // Use SECURITY DEFINER RPC to avoid RLS circular-dependency on households
      const { data, error } = await supabase.rpc('create_household', {
        household_name: householdName || 'Nuestro hogar',
      });
      if (error) throw error;
      setHouseholdId(data as string);
      setStep('profile');
    } catch (err: unknown) {
      console.error(err);
      toast.error('Error al crear el hogar. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function joinHousehold() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('join_household', {
        invite_code: joinCode.toUpperCase().trim(),
      });
      if (error) {
        if (error.message?.includes('invalid_or_expired_code')) {
          toast.error('Código inválido o expirado. Pedile uno nuevo a tu pareja.');
        } else {
          throw error;
        }
        return;
      }
      setHouseholdId(data as string);
      setStep('profile');
    } catch (err: unknown) {
      console.error(err);
      toast.error('Algo salió mal. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');
      const { error } = await supabase
        .from('profiles')
        .update({ nickname: nickname.trim() || 'Morch' })
        .eq('id', user.id);
      if (error) throw error;
      router.push('/onboarding');
    } catch (err: unknown) {
      console.error(err);
      toast.error('Error al guardar. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  // ── CHOOSE ─────────────────────────────────────────────────────────────────
  if (step === 'choose') {
    return (
      <Screen>
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🏡</div>
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>
            ¿Cómo arrancamos?
          </h1>
        </div>
        <div className="flex flex-col gap-3">
          <Btn onClick={() => setStep('create')}>Crear un hogar nuevo</Btn>
          <Btn variant="outline" onClick={() => setStep('join')}>Unirme con código</Btn>
        </div>
      </Screen>
    );
  }

  // ── CREATE ──────────────────────────────────────────────────────────────────
  if (step === 'create') {
    return (
      <Screen>
        <BackBtn onClick={() => setStep('choose')} />
        <h1 className="text-2xl font-black mb-6" style={{ color: '#2D2D2D' }}>Crear hogar</h1>
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2" style={{ color: '#2D2D2D' }}>
            Nombre del hogar (opcional)
          </label>
          <TextInput
            value={householdName}
            onChange={setHouseholdName}
            placeholder="Ej: Lucas y Sofi 💚"
          />
        </div>
        <Btn onClick={createHousehold} disabled={loading}>
          {loading ? 'Creando...' : 'Crear hogar'}
        </Btn>
      </Screen>
    );
  }

  // ── JOIN ────────────────────────────────────────────────────────────────────
  if (step === 'join') {
    return (
      <Screen>
        <BackBtn onClick={() => setStep('choose')} />
        <h1 className="text-2xl font-black mb-2" style={{ color: '#2D2D2D' }}>Unirme al hogar</h1>
        <p className="text-sm mb-6" style={{ color: '#8A8276' }}>
          Pedile el código de 6 letras a tu pareja desde la app.
        </p>
        <div className="mb-4">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="w-full px-4 py-3 rounded-2xl text-2xl font-black text-center tracking-widest outline-none border"
            style={{ background: '#FFFFFF', borderColor: '#ECE5DC', color: '#2D2D2D' }}
          />
        </div>
        <Btn onClick={joinHousehold} disabled={loading || joinCode.length < 6}>
          {loading ? 'Verificando...' : 'Unirme'}
        </Btn>
      </Screen>
    );
  }

  // ── PROFILE ─────────────────────────────────────────────────────────────────
  return (
    <Screen>
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">✨</div>
        <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>¿Cómo te llamamos?</h1>
        <p className="text-sm mt-1" style={{ color: '#8A8276' }}>Usamos tu apodo en la app.</p>
      </div>
      <div className="mb-4">
        <TextInput
          value={nickname}
          onChange={setNickname}
          placeholder="Ej: Morch, Lucas, Sofi..."
          center
        />
      </div>

      {/* Invite code section — only shown if user just CREATED the household */}
      {householdId && <InviteCodeSection householdId={householdId} />}

      <Btn onClick={saveProfile} disabled={loading}>
        {loading ? 'Guardando...' : 'Listo, entremos ✓'}
      </Btn>
    </Screen>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F9F5F0' }}>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function Btn({
  children, onClick, disabled, variant = 'primary',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'outline';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-4 rounded-2xl text-base font-bold transition-opacity disabled:opacity-50"
      style={
        variant === 'primary'
          ? { background: '#7EC8A4', color: '#fff' }
          : { background: 'transparent', color: '#7EC8A4', border: '2px solid #7EC8A4' }
      }
    >
      {children}
    </button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-6 text-sm" style={{ color: '#8A8276' }}>
      ← Volver
    </button>
  );
}

function TextInput({
  value, onChange, placeholder, center,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  center?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-3 rounded-2xl text-base outline-none border"
      style={{
        background: '#FFFFFF',
        borderColor: '#ECE5DC',
        color: '#2D2D2D',
        textAlign: center ? 'center' : 'left',
      }}
    />
  );
}

function InviteCodeSection({ householdId }: { householdId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function generateCode() {
    setLoading(true);
    const { data, error } = await supabase.rpc('generate_invite_code');
    if (!error && data) setCode(data as string);
    else toast.error('No se pudo generar el código.');
    setLoading(false);
  }

  // suppress unused warning — householdId used implicitly via RPC
  void householdId;

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: '#E4F2EA' }}>
      <p className="text-sm font-semibold mb-2" style={{ color: '#2D2D2D' }}>
        Invitá a tu pareja 💌
      </p>
      {code ? (
        <div className="text-center">
          <div className="text-3xl font-black tracking-widest mb-1" style={{ color: '#5BA886' }}>
            {code}
          </div>
          <p className="text-xs" style={{ color: '#8A8276' }}>
            Que lo ingrese en &quot;Unirme con código&quot;. Expira en 7 días.
          </p>
        </div>
      ) : (
        <button
          onClick={generateCode}
          disabled={loading}
          className="text-sm font-bold underline disabled:opacity-50"
          style={{ color: '#5BA886' }}
        >
          {loading ? 'Generando...' : 'Generar código de invitación'}
        </button>
      )}
    </div>
  );
}
