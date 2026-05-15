import type { ChartKind } from '../../types';
import { AreaChart } from './AreaChart';
import { Bars } from './Bars';
import { Sparkline } from './Sparkline';

interface Props {
  kind?: ChartKind;
  data: number[];
  max?: number;
  color?: string;
  height?: number;
}

export function AutoChart({ kind, data, max, color, height }: Props) {
  if (kind === 'sparkline') return <Sparkline data={data} color={color} height={height ?? 32} />;
  if (kind === 'bars') return <Bars data={data} max={max} height={height ?? 48} />;
  return <AreaChart data={data} color={color} height={height ?? 56} />;
}
