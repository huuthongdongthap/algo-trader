/**
 * Settings page: composition of tenant config, exchange keys, and alert rules panels.
 * Data is fetched here and passed down to each sub-component.
 * POST /tenants/:id/api-keys, DELETE /tenants/:id/api-keys/:keyId
 * GET /tenants/me, GET /tenants/:id/api-keys, GET /tenants/:id/alert-rules
 */
import React, { useState, useEffect } from 'react';
import { useApiClient } from '../hooks/use-api-client';
import { useAuthStore } from '../stores/auth-store';
import { SettingsTenantConfigForm, type TenantInfo } from '../components/settings-tenant-config-form';
import { SettingsExchangeKeysForm, type ApiKey } from '../components/settings-exchange-keys-form';
import { SettingsAlertRulesForm, type AlertRule } from '../components/settings-alert-rules-form';

const MOCK_KEYS: ApiKey[] = [];
const MOCK_ALERTS: AlertRule[] = [];

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-bg-card border border-bg-border rounded-lg p-6 space-y-4">
      {children}
    </section>
  );
}

const MM_FIELDS: { key: string; label: string; description: string; placeholder: string }[] = [
  { key: 'MM_SPREAD', label: 'MM_SPREAD', description: 'Half-spread quoted on each side (e.g. 0.05 = 5%)', placeholder: '0.05' },
  { key: 'MM_SIZE', label: 'MM_SIZE', description: 'Position size per order in USDC', placeholder: '10' },
  { key: 'MM_MAX_MARKETS', label: 'MM_MAX_MARKETS', description: 'Maximum number of markets to quote simultaneously', placeholder: '5' },
  { key: 'MM_MAX_INVENTORY', label: 'MM_MAX_INVENTORY', description: 'Max net inventory exposure per market in USDC', placeholder: '50' },
];

function MmParametersForm() {
  const { fetchApi } = useApiClient();
  const { tenantId } = useAuthStore();
  const [values, setValues] = useState<Record<string, string>>({
    MM_SPREAD: '0.05',
    MM_SIZE: '10',
    MM_MAX_MARKETS: '5',
    MM_MAX_INVENTORY: '50',
  });
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setStatusMsg(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    const res = await fetchApi(`/tenants/${tenantId ?? 'me'}/mm-parameters`, {
      method: 'POST',
      body: JSON.stringify(values),
    });
    setSaving(false);
    if (res !== null) {
      setStatusMsg({ text: 'Saved', ok: true });
    } else {
      setStatusMsg({ text: 'Backend not configured — changes not persisted', ok: false });
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white text-sm font-bold font-mono">MM Parameters</h2>
        {statusMsg && (
          <span className={`text-xs font-mono ${statusMsg.ok ? 'text-profit' : 'text-muted'}`}>
            {statusMsg.text}
          </span>
        )}
      </div>
      <p className="text-muted text-xs font-mono">Market making strategy configuration. Changes take effect on next requote cycle.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MM_FIELDS.map(({ key, label, description, placeholder }) => (
          <div key={key}>
            <label className="block text-accent text-xs font-mono mb-1">{label}</label>
            <input
              type="text"
              value={values[key]}
              onChange={(e) => handleChange(key, e.target.value)}
              placeholder={placeholder}
              className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-accent placeholder:text-muted transition-colors"
            />
            <p className="text-muted text-[10px] font-mono mt-1">{description}</p>
          </div>
        ))}
      </div>
      <button
        type="submit"
        disabled={saving}
        className="bg-accent text-bg font-bold text-xs font-mono px-4 py-2 rounded hover:bg-accent/80 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : 'Save Parameters'}
      </button>
    </form>
  );
}

export function SettingsPage() {
  const { fetchApi } = useApiClient();
  const { email, tier, tenantId } = useAuthStore();

  const authTenant: TenantInfo = {
    id: tenantId ?? 'unknown',
    name: email || 'My Account',
    tier: tier.toUpperCase() as TenantInfo['tier'],
    createdAt: new Date().toISOString(),
    allowedExchanges: ['binance', 'kraken', 'coinbase', 'bybit'],
  };

  const [tenant, setTenant] = useState<TenantInfo>(authTenant);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(MOCK_KEYS);
  const [alerts, setAlerts] = useState<AlertRule[]>(MOCK_ALERTS);
  const [newKeyVisible, setNewKeyVisible] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  useEffect(() => {
    fetchApi<TenantInfo>('/tenants/me').then((d) => { if (d) setTenant(d); else setTenant(authTenant); });
    fetchApi<ApiKey[]>(`/tenants/${tenant.id}/api-keys`).then((d) => { if (d) setApiKeys(d); });
    fetchApi<AlertRule[]>(`/tenants/${tenant.id}/alert-rules`).then((d) => { if (d) setAlerts(d); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateKey() {
    setCreatingKey(true);
    const res = await fetchApi<{ key: string; id: string; prefix: string; maskedKey: string }>(
      `/tenants/${tenant.id}/api-keys`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    setCreatingKey(false);
    if (res) {
      setNewKeyVisible(res.key ?? 'ak_live_mock_' + Math.random().toString(36).slice(2, 10));
      setApiKeys((prev) => [...prev, {
        id: res.id ?? `k${Date.now()}`,
        prefix: res.prefix ?? 'ak_live',
        maskedKey: res.maskedKey ?? `ak_live_••••••••${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
      }]);
    } else {
      const mockKey = 'ak_live_mock_' + Math.random().toString(36).slice(2, 10);
      setNewKeyVisible(mockKey);
      setApiKeys((prev) => [...prev, { id: `k${Date.now()}`, prefix: 'ak_live', maskedKey: mockKey.slice(0, 8) + '••••••••', createdAt: new Date().toISOString() }]);
    }
  }

  async function handleDeleteKey(keyId: string) {
    await fetchApi(`/tenants/${tenant.id}/api-keys/${keyId}`, { method: 'DELETE' });
    setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
  }

  async function handleAddAlert(payload: Omit<AlertRule, 'id'>) {
    const res = await fetchApi<AlertRule>(`/tenants/${tenant.id}/alert-rules`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAlerts((prev) => [...prev, res ?? { id: `a${Date.now()}`, ...payload }]);
  }

  async function handleDeleteAlert(alertId: string) {
    await fetchApi(`/tenants/${tenant.id}/alert-rules/${alertId}`, { method: 'DELETE' });
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <h1 className="text-white text-2xl font-bold">Settings</h1>

      {/* MM Parameters */}
      <Card>
        <MmParametersForm />
      </Card>

      <SettingsTenantConfigForm tenant={tenant} />
      <Card>
        <SettingsExchangeKeysForm
          tenantId={tenant.id}
          apiKeys={apiKeys}
          newKeyVisible={newKeyVisible}
          creatingKey={creatingKey}
          onCreateKey={handleCreateKey}
          onDeleteKey={handleDeleteKey}
          onDismissNewKey={() => setNewKeyVisible(null)}
        />
      </Card>
      <Card>
        <SettingsAlertRulesForm
          alerts={alerts}
          onAddAlert={handleAddAlert}
          onDeleteAlert={handleDeleteAlert}
        />
      </Card>
    </div>
  );
}

export default SettingsPage;
