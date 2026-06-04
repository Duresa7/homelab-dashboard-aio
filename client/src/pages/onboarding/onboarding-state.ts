import type { Capability, ConfigField, TestResult } from '@/lib/setup';

export type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; message?: string }
  | { status: 'error'; message: string }
  | { status: 'untestable'; message?: string };

export interface CapabilitySelection {
  enabled: boolean;
  vendor: string;
  config: Record<string, unknown>;
  testState: TestState;
}

export interface WizardState {
  stepIndex: number;
  selections: Record<string, CapabilitySelection>;
}

export type WizardAction =
  | { type: 'reset'; capabilities: Capability[] }
  | { type: 'next'; maxStep: number }
  | { type: 'back' }
  | { type: 'goTo'; stepIndex: number }
  | { type: 'setEnabled'; capabilityId: string; enabled: boolean }
  | { type: 'setVendor'; capabilityId: string; vendor: string; capability: Capability }
  | { type: 'setField'; capabilityId: string; field: string; value: unknown }
  | { type: 'setTestState'; capabilityId: string; testState: TestState };

export function firstAvailableProvider(capability: Capability): string {
  return (
    capability.providers.find((provider) => provider.status === 'available') ??
    capability.providers[0]
  )?.id;
}

function valueFromDefault(field: ConfigField): unknown {
  if (field.default !== undefined) return field.default;
  if (field.type === 'boolean') return false;
  return '';
}

function configForVendor(capability: Capability, vendor: string): Record<string, unknown> {
  const provider = capability.providers.find((p) => p.id === vendor);
  const config: Record<string, unknown> = {};
  for (const field of provider?.configSchema ?? []) {
    config[field.name] = valueFromDefault(field);
  }
  return config;
}

export function createWizardState(capabilities: Capability[]): WizardState {
  const selections: Record<string, CapabilitySelection> = {};
  for (const capability of capabilities) {
    const vendor = firstAvailableProvider(capability);
    selections[capability.id] = {
      enabled: false,
      vendor,
      config: configForVendor(capability, vendor),
      testState: { status: 'idle' },
    };
  }
  return { stepIndex: 0, selections };
}

export function onboardingReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'reset':
      return createWizardState(action.capabilities);
    case 'next':
      return { ...state, stepIndex: Math.min(state.stepIndex + 1, action.maxStep) };
    case 'back':
      return { ...state, stepIndex: Math.max(state.stepIndex - 1, 0) };
    case 'goTo':
      return { ...state, stepIndex: Math.max(action.stepIndex, 0) };
    case 'setEnabled':
      return {
        ...state,
        selections: {
          ...state.selections,
          [action.capabilityId]: {
            ...state.selections[action.capabilityId],
            enabled: action.enabled,
            testState: { status: 'idle' },
          },
        },
      };
    case 'setVendor':
      return {
        ...state,
        selections: {
          ...state.selections,
          [action.capabilityId]: {
            ...state.selections[action.capabilityId],
            vendor: action.vendor,
            config: configForVendor(action.capability, action.vendor),
            testState: { status: 'idle' },
          },
        },
      };
    case 'setField':
      return {
        ...state,
        selections: {
          ...state.selections,
          [action.capabilityId]: {
            ...state.selections[action.capabilityId],
            config: {
              ...state.selections[action.capabilityId].config,
              [action.field]: action.value,
            },
            testState: { status: 'idle' },
          },
        },
      };
    case 'setTestState':
      return {
        ...state,
        selections: {
          ...state.selections,
          [action.capabilityId]: {
            ...state.selections[action.capabilityId],
            testState: action.testState,
          },
        },
      };
  }
}

export function providerForSelection(capability: Capability, selection: CapabilitySelection) {
  return capability.providers.find((provider) => provider.id === selection.vendor);
}

export function enabledCapabilities(
  capabilities: Capability[],
  selections: Record<string, CapabilitySelection>,
): Capability[] {
  return capabilities.filter((capability) => selections[capability.id]?.enabled);
}

export function missingRequiredFields(
  capability: Capability,
  selection: CapabilitySelection,
): string[] {
  if (!selection.enabled) return [];
  const provider = providerForSelection(capability, selection);
  if (!provider) return ['vendor'];
  return provider.configSchema
    .filter((field) => {
      if (!field.required) return false;
      const value = selection.config[field.name];
      return value === undefined || value === null || value === '';
    })
    .map((field) => field.label);
}

export function hasMissingRequiredFields(
  capabilities: Capability[],
  selections: Record<string, CapabilitySelection>,
): boolean {
  return capabilities.some(
    (capability) => missingRequiredFields(capability, selections[capability.id]).length > 0,
  );
}

export function testStateFromResult(result: TestResult): TestState {
  if (result.untestable) return { status: 'untestable', message: result.error };
  if (result.ok) return { status: 'ok' };
  return { status: 'error', message: result.error ?? 'Connection test failed' };
}
