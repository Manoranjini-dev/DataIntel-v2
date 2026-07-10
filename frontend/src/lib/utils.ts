import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function cleanDateString(str: unknown): string {
  if (str == null) return '';
  const s = String(str);
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(s)) {
    return s.slice(0, 10);
  }
  return s;
}

export function formatDisplayCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (val instanceof Date) {
      const iso = val.toISOString();
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(iso) ? iso.slice(0, 10) : iso.replace('T', ' ').replace(/\.\d+Z$/, '');
    }
    return JSON.stringify(val);
  }
  return cleanDateString(val);
}
