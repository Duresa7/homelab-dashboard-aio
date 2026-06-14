import { useEffect, useMemo, useReducer, useState, type Dispatch, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  PlugZap,
  Save,
  Server,
  Settings2,
  TestTube2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  completeOnboarding,
  getDbConfig,
  putSelection,
  saveDbConfig,
  testIntegration,
  testDbConnection,
  useCapabilities,
  type Capability,
} from '@/lib/setup';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/common';
import {
  createWizardState,
  enabledCapabilities,
  hasMissingRequiredFields,
  missingRequiredFields,
  onboardingReducer,
  providerForSelection,
  testStateFromResult,
  type CapabilitySelection,
} from './onboarding-state';
import { ConfigFieldsForm } from './steps/ConfigFieldsForm';
import { DatabaseStep } from './steps/DatabaseStep';
import {
  dbBodyFromDraft,
  dbDirty,
  dbDraftFromView,
  EMPTY_DB_DRAFT,
  type DbDraft,
  type DbStepStatus,
} from './db-state';
import { PresentationIcon, type CapabilityId } from '@/lib/presentation';

interface Props {
  onDone: () => void | Promise<void>;
}

interface StepDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

const CORE_STEPS: StepDef[] = [
  { id: 'database', label: 'Database', icon: Database },
  { id: 'capabilities', label: 'Capabilities', icon: Settings2 },
  { id: 'vendors', label: 'Vendors', icon: PlugZap },
  { id: 'credentials', label: 'Credentials', icon: Server },
  { id: 'test', label: 'Test', icon: TestTube2 },
  { id: 'finish', label: 'Finish', icon: CheckCircle2 },
];

const PRESENTATION_CAPABILITY_IDS = new Set<string>([
  'datacenter',
  'network',
  'nas',
  'containers',
  'gpu',
  'sensors',
  'logs',
]);

function presentationCapabilityId(id: string): CapabilityId | null {
  return PRESENTATION_CAPABILITY_IDS.has(id) ? (id as CapabilityId) : null;
}

function selectionSummary(selection: CapabilitySelection): string {
  if (!selection.enabled) return 'Skipped';
  if (selection.testState.status === 'ok') return 'Test passed';
  if (selection.testState.status === 'untestable') return "Can't test automatically";
  if (selection.testState.status === 'error') return selection.testState.message;
  return 'Ready';
}

export function OnboardingWizard({ onDone }: Props) {
  const { capabilities, loading, error } = useCapabilities();
  const [state, dispatch] = useReducer(onboardingReducer, capabilities, createWizardState);
  const [dbDraft, setDbDraft] = useState<DbDraft>(EMPTY_DB_DRAFT);
  const [initialDbDraft, setInitialDbDraft] = useState<DbDraft>(EMPTY_DB_DRAFT);
  const [dbStatus, setDbStatus] = useState<DbStepStatus>({
    busy: false,
    message: 'SQLite works without extra setup.',
    restartRequired: false,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const enabled = useMemo(
    () => enabledCapabilities(capabilities, state.selections),
    [capabilities, state.selections],
  );
  const maxStep = CORE_STEPS.length - 1;
  const activeStep = CORE_STEPS[state.stepIndex] ?? CORE_STEPS[0];

  useEffect(() => {
    if (capabilities.length) dispatch({ type: 'reset', capabilities });
  }, [capabilities]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const draft = dbDraftFromView(await getDbConfig());
        if (cancelled) return;
        setDbDraft(draft);
        setInitialDbDraft(draft);
        setDbStatus({
          busy: false,
          message:
            draft.driver === 'sqlite'
              ? 'SQLite works without extra setup.'
              : 'Saved backend loaded. Test before changing it.',
          restartRequired: false,
        });
      } catch (err) {
        if (cancelled) return;
        setDbStatus({
          busy: false,
          message: err instanceof Error ? err.message : String(err),
          restartRequired: false,
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const credentialsInvalid = hasMissingRequiredFields(capabilities, state.selections);
  const dbIsDirty = dbDirty(dbDraft, initialDbDraft);
  const nextDisabled =
    (activeStep.id === 'database' && dbStatus.busy) ||
    (activeStep.id === 'credentials' && credentialsInvalid) ||
    (activeStep.id === 'vendors' &&
      enabled.some(
        (capability) => !providerForSelection(capability, state.selections[capability.id]),
      ));

  const testAll = async () => {
    setTesting(true);
    try {
      for (const capability of enabled) {
        const selection = state.selections[capability.id];
        dispatch({
          type: 'setTestState',
          capabilityId: capability.id,
          testState: { status: 'running' },
        });
        const result = await testIntegration({
          capability: capability.id,
          config: selection.config,
        });
        dispatch({
          type: 'setTestState',
          capabilityId: capability.id,
          testState: testStateFromResult(result),
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const testDatabase = async () => {
    setDbStatus({ busy: true, message: 'Testing database connection...', restartRequired: false });
    try {
      const result = await testDbConnection(dbBodyFromDraft(dbDraft));
      setDbStatus({
        busy: false,
        message: result.ok ? 'Connection test passed.' : (result.error ?? 'Connection failed.'),
        restartRequired: false,
      });
    } catch (err) {
      setDbStatus({
        busy: false,
        message: err instanceof Error ? err.message : String(err),
        restartRequired: false,
      });
    }
  };

  const saveDatabase = async () => {
    setDbStatus({ busy: true, message: 'Saving database settings...', restartRequired: false });
    try {
      await saveDbConfig(dbBodyFromDraft(dbDraft));
      const restartRequired = dbIsDirty;
      setInitialDbDraft(dbDraft);
      setDbStatus({
        busy: false,
        message: restartRequired
          ? 'Saved. Restart the server to apply this backend.'
          : 'Database settings saved.',
        restartRequired,
      });
    } catch (err) {
      setDbStatus({
        busy: false,
        message: err instanceof Error ? err.message : String(err),
        restartRequired: false,
      });
    }
  };

  const saveAndFinish = async () => {
    setSaving(true);
    try {
      for (const capability of enabled) {
        const selection = state.selections[capability.id];
        await putSelection({
          capability: capability.id,
          vendor: selection.vendor,
          enabled: true,
          config: selection.config,
          secretSource: selection.secretSource,
        });
      }
      await completeOnboarding();
      toast.success('Setup saved');
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              First-run setup
            </p>
            <h1 className="mt-2 font-display text-2xl tracking-tight">Homelab Dashboard</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {CORE_STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <button
                  key={step.id}
                  type="button"
                  disabled={index > state.stepIndex}
                  onClick={() => dispatch({ type: 'goTo', stepIndex: index })}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors',
                    index === state.stepIndex
                      ? 'border-primary bg-primary text-primary-foreground'
                      : index < state.stepIndex
                        ? 'border-border bg-card text-foreground hover:bg-accent'
                        : 'border-border/60 bg-muted/40 text-muted-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  {step.label}
                </button>
              );
            })}
          </div>
        </header>

        <section className="flex flex-1 flex-col rounded-xl border border-border bg-card p-5 shadow-card">
          {activeStep.id === 'database' ? (
            <DatabaseStep
              draft={dbDraft}
              status={dbStatus}
              dirty={dbIsDirty}
              onChange={(next) => {
                setDbDraft(next);
                setDbStatus({
                  busy: false,
                  message: 'Test or save when you are ready.',
                  restartRequired: false,
                });
              }}
              onTest={testDatabase}
              onSave={saveDatabase}
            />
          ) : loading ? (
            <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
              Loading setup options...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-bad/40 bg-bad/10 p-4 text-sm text-foreground">
              {error}
            </div>
          ) : (
            <WizardStep
              step={activeStep.id}
              capabilities={capabilities}
              selections={state.selections}
              enabled={enabled}
              testing={testing}
              onDispatch={dispatch}
              onTestAll={testAll}
            />
          )}

          <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={state.stepIndex === 0 || saving}
              onClick={() => dispatch({ type: 'back' })}
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
            <div className="flex gap-2">
              {activeStep.id === 'finish' ? (
                <Button
                  type="button"
                  disabled={saving || credentialsInvalid}
                  onClick={saveAndFinish}
                >
                  <Save className="size-4" />
                  {saving ? 'Saving...' : 'Save and finish'}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={nextDisabled || saving || loading}
                  onClick={() => dispatch({ type: 'next', maxStep })}
                >
                  Continue
                  <ChevronRight className="size-4" />
                </Button>
              )}
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}

function WizardStep({
  step,
  capabilities,
  selections,
  enabled,
  testing,
  onDispatch,
  onTestAll,
}: {
  step: string;
  capabilities: Capability[];
  selections: Record<string, CapabilitySelection>;
  enabled: Capability[];
  testing: boolean;
  onDispatch: Dispatch<Parameters<typeof onboardingReducer>[1]>;
  onTestAll: () => void;
}) {
  if (step === 'capabilities') {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {capabilities.map((capability) => {
          const presentationId = presentationCapabilityId(capability.id);
          const selection = selections[capability.id];
          return (
            <label
              key={capability.id}
              className="flex min-h-24 cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-4 transition-colors hover:bg-accent/50"
            >
              <Checkbox
                checked={selection?.enabled}
                onCheckedChange={(checked) =>
                  onDispatch({
                    type: 'setEnabled',
                    capabilityId: capability.id,
                    enabled: checked === true,
                  })
                }
              />
              <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
                {presentationId ? (
                  <PresentationIcon capability={presentationId} className="size-4" />
                ) : (
                  <PlugZap className="size-4" />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-medium text-foreground">{capability.label}</span>
                <span className="text-sm text-muted-foreground">
                  {capability.providers.filter((p) => p.status === 'available').length} available
                  provider
                </span>
              </span>
            </label>
          );
        })}
      </div>
    );
  }

  if (step === 'vendors') {
    if (enabled.length === 0) return <EmptyState>No capabilities selected.</EmptyState>;
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {enabled.map((capability) => {
          const selection = selections[capability.id];
          return (
            <section
              key={capability.id}
              className="rounded-lg border border-border bg-background p-4"
            >
              <h2 className="mb-3 font-medium text-foreground">{capability.label}</h2>
              <Select
                value={selection.vendor}
                onValueChange={(vendor) =>
                  onDispatch({ type: 'setVendor', capabilityId: capability.id, vendor, capability })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {capability.providers.map((provider) => (
                    <SelectItem
                      key={provider.id}
                      value={provider.id}
                      disabled={provider.status !== 'available'}
                    >
                      {provider.label}
                      {provider.status === 'planned' ? ' (coming soon)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>
          );
        })}
      </div>
    );
  }

  if (step === 'credentials') {
    if (enabled.length === 0) return <EmptyState>No credentials required.</EmptyState>;
    return (
      <div className="flex flex-col gap-5">
        {enabled.map((capability) => {
          const selection = selections[capability.id];
          const provider = providerForSelection(capability, selection);
          const missing = missingRequiredFields(capability, selection);
          return (
            <section
              key={capability.id}
              className="rounded-lg border border-border bg-background p-4"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-medium text-foreground">{capability.label}</h2>
                  <p className="text-sm text-muted-foreground">{provider?.label}</p>
                </div>
                {missing.length ? (
                  <StatusBadge kind="warn">Missing {missing.length}</StatusBadge>
                ) : null}
              </div>
              <ConfigFieldsForm
                fields={provider?.configSchema ?? []}
                values={selection.config}
                secretSource={selection.secretSource}
                onSecretSourceChange={(next) =>
                  onDispatch({
                    type: 'setSecretSource',
                    capabilityId: capability.id,
                    secretSource: next,
                  })
                }
                idPrefix={`setup-${capability.id}`}
                onChange={(field, value) =>
                  onDispatch({ type: 'setField', capabilityId: capability.id, field, value })
                }
              />
            </section>
          );
        })}
      </div>
    );
  }

  if (step === 'test') {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg tracking-tight">Connection tests</h2>
            <p className="text-sm text-muted-foreground">
              Tests are advisory. SSH and listener-style capabilities may not have an HTTP check.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={testing || enabled.length === 0}
            onClick={onTestAll}
          >
            <TestTube2 className="size-4" />
            {testing ? 'Testing...' : 'Test selected'}
          </Button>
        </div>
        {enabled.length === 0 ? <EmptyState>No capabilities selected.</EmptyState> : null}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {enabled.map((capability) => {
            const selection = selections[capability.id];
            const kind =
              selection.testState.status === 'ok'
                ? 'ok'
                : selection.testState.status === 'error'
                  ? 'bad'
                  : selection.testState.status === 'untestable'
                    ? 'info'
                    : 'warn';
            return (
              <div
                key={capability.id}
                className="rounded-lg border border-border bg-background p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{capability.label}</span>
                  <StatusBadge kind={kind}>{selection.testState.status}</StatusBadge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{selectionSummary(selection)}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col justify-center gap-4 text-center">
      <CheckCircle2 className="mx-auto size-12 text-ok" />
      <div>
        <h2 className="font-display text-xl tracking-tight">Ready to save</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          The selected setup will be saved and applied to live telemetry.
        </p>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-48 place-items-center rounded-lg border border-dashed border-border bg-background text-sm text-muted-foreground">
      {children}
    </div>
  );
}
