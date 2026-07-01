import { describe, expect, it } from 'vitest';

import {
  createWizardState,
  hasMissingRequiredFields,
  onboardingReducer,
  testStateFromResult,
} from './onboarding-state';
import type { Capability } from '@/lib/setup';

const capabilities: Capability[] = [
  {
    id: 'network',
    label: 'Network',
    integrationKey: 'unifi',
    providers: [
      {
        id: 'unifi',
        label: 'UniFi',
        icon: 'unifi',
        adapter: 'unifi',
        status: 'available',
        configSchema: [
          { name: 'baseUrl', label: 'Base URL', type: 'url', required: true },
          { name: 'apiKey', label: 'API key', type: 'password', required: true, secret: true },
        ],
      },
    ],
  },
];

describe('onboarding reducer', () => {
  it('advances and backs up through bounded steps', () => {
    const state = createWizardState(capabilities);

    const next = onboardingReducer(state, { type: 'next', maxStep: 2 });
    expect(next.stepIndex).toBe(1);

    const capped = onboardingReducer(next, { type: 'next', maxStep: 1 });
    expect(capped.stepIndex).toBe(1);

    const back = onboardingReducer(capped, { type: 'back' });
    expect(back.stepIndex).toBe(0);
  });

  it('tracks required-field validation for enabled capabilities', () => {
    let state = createWizardState(capabilities);
    expect(hasMissingRequiredFields(capabilities, state.selections)).toBe(false);

    state = onboardingReducer(state, {
      type: 'setEnabled',
      capabilityId: 'network',
      enabled: true,
    });
    expect(hasMissingRequiredFields(capabilities, state.selections)).toBe(true);

    state = onboardingReducer(state, {
      type: 'setField',
      capabilityId: 'network',
      field: 'baseUrl',
      value: 'https://gateway.local',
    });
    state = onboardingReducer(state, {
      type: 'setField',
      capabilityId: 'network',
      field: 'apiKey',
      value: 'secret',
    });
    expect(hasMissingRequiredFields(capabilities, state.selections)).toBe(false);
  });

  it('tolerates capabilities loading before selections are initialized', () => {
    expect(hasMissingRequiredFields(capabilities, {})).toBe(false);
  });

  it('maps setup test results into display state', () => {
    expect(testStateFromResult({ ok: true })).toEqual({ status: 'ok' });
    expect(testStateFromResult({ ok: true, message: 'Detected cluster.' })).toEqual({
      status: 'ok',
      message: 'Detected cluster.',
    });
    expect(testStateFromResult({ ok: true, untestable: true })).toEqual({
      status: 'untestable',
      message: undefined,
    });
    expect(testStateFromResult({ ok: false, error: 'HTTP 401' })).toEqual({
      status: 'error',
      message: 'HTTP 401',
    });
  });

  it('applies discovered config without resetting test status', () => {
    let state = createWizardState(capabilities);
    state = onboardingReducer(state, {
      type: 'setTestState',
      capabilityId: 'network',
      testState: { status: 'ok', message: 'previous' },
    });
    state = onboardingReducer(state, {
      type: 'applyConfigPatch',
      capabilityId: 'network',
      patch: { site: 'default', baseUrl: 'https://gateway.local' },
    });

    expect(state.selections.network.config).toMatchObject({
      baseUrl: 'https://gateway.local',
      site: 'default',
    });
    expect(state.selections.network.testState).toEqual({ status: 'ok', message: 'previous' });
  });
});
