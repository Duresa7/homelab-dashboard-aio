import {
  Activity,
  Boxes,
  Container,
  FlaskConical,
  HardDrive,
  LayoutDashboard,
  Network,
  Server,
  Settings,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Section } from '@/lib/route';

export interface NavItemDef {
  section: Section;
  icon: LucideIcon;
  /** Whether this item owns sub-pages (from SUBS). */
  hasSubs?: boolean;
}

export interface NavGroupDef {
  label?: string;
  items: NavItemDef[];
}

/** Single source of truth for primary navigation — shared by the sidebar and command palette. */
export const NAV_GROUPS: NavGroupDef[] = [
  { items: [{ section: 'overview', icon: LayoutDashboard }] },
  {
    label: 'Systems',
    items: [
      { section: 'proxmox', icon: Server, hasSubs: true },
      { section: 'network', icon: Network, hasSubs: true },
      { section: 'docker', icon: Container, hasSubs: true },
      { section: 'nas', icon: HardDrive, hasSubs: true },
    ],
  },
  {
    label: 'Observability',
    items: [{ section: 'observability', icon: Activity, hasSubs: true }],
  },
  {
    label: 'Utilities',
    items: [
      { section: 'inventory', icon: Boxes },
      { section: 'tools', icon: Wrench },
      { section: 'playground', icon: FlaskConical },
    ],
  },
  {
    label: 'Preferences',
    items: [{ section: 'settings', icon: Settings }],
  },
];
