import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetIdentity, setTenantId, getTenantId, type Identity } from '@workspace/api-client-react';
import { qopts } from '@/lib/vault';

type Ctx = {
  identity: Identity | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  tenant: string | null;
  switchTenant: (t: string | null) => void;
  isAdmin: boolean;
};
const IdentityCtx = createContext<Ctx | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useGetIdentity({ query: { ...qopts } });
  const [tenant, setTenant] = useState<string | null>(getTenantId());
  const switchTenant = (t: string | null) => {
    setTenantId(t);
    setTenant(t);
    void qc.resetQueries();
  };
  return (
    <IdentityCtx.Provider
      value={{
        identity: q.data,
        isLoading: q.isLoading,
        error: q.error,
        refetch: () => void q.refetch(),
        tenant,
        switchTenant,
        isAdmin: q.data?.role === 'admin',
      }}
    >
      {children}
    </IdentityCtx.Provider>
  );
}

export function useIdentity() {
  const c = useContext(IdentityCtx);
  if (!c) throw new Error('useIdentity outside provider');
  return c;
}
