'use client';

import { useMemo } from 'react';
import {
  applyIndustryPreset,
  FEATURE_DEFINITIONS,
  normalizeBusinessConfig,
  type BusinessFeatureConfig,
  type BusinessFeatureKey,
} from '@/lib/business-config';

type Props = {
  value: BusinessFeatureConfig;
  onChange: (value: BusinessFeatureConfig) => void;
  categoryName?: string | null;
  subcategoryName?: string | null;
  compact?: boolean;
};

const categories = [
  'Offering & Operational Model',
  'Sales & CRM Motions',
  'Financial Governance & Invoicing',
];

export default function BusinessCapabilitiesChecklist({
  value,
  onChange,
  categoryName,
  subcategoryName,
  compact = false,
}: Props) {
  const preset = useMemo(
    () => applyIndustryPreset(categoryName, subcategoryName),
    [categoryName, subcategoryName],
  );

  const setFlag = (key: BusinessFeatureKey, checked: boolean) => {
    const next = normalizeBusinessConfig({ ...value, [key]: checked }, categoryName, subcategoryName);
    onChange(next);
  };

  const applyPreset = () => onChange(normalizeBusinessConfig({ ...preset }, categoryName, subcategoryName));

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <div className="flex flex-col gap-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-700">Business Nature & Capabilities</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Turn on only the capabilities this business actually uses. Moneymatters uses these settings to shape navigation, forms and accounting defaults.
          </p>
        </div>
        {preset.industry_preset !== 'custom' && (
          <button
            type="button"
            onClick={applyPreset}
            className="shrink-0 rounded-xl border border-violet-200 bg-white px-3.5 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50"
          >
            Apply {preset.industry_preset.replaceAll('_', ' ')} defaults
          </button>
        )}
      </div>

      {categories.map((category) => (
        <section key={category}>
          <div className="mb-3">
            <h3 className="text-sm font-bold text-slate-900">{category}</h3>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {FEATURE_DEFINITIONS.filter((feature) => feature.category === category).map((feature) => {
              const enabled = Boolean(value[feature.key]);
              const dependency = 'dependsOn' in feature ? feature.dependsOn : undefined;
              const dependencyEnabled = dependency ? Boolean(value[dependency]) : true;

              return (
                <label
                  key={feature.key}
                  className={`flex gap-3 rounded-2xl border p-4 transition ${enabled ? 'border-violet-300 bg-violet-50/60' : 'border-slate-200 bg-white'} ${dependency && !dependencyEnabled ? 'opacity-70' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={Boolean(dependency && !dependencyEnabled)}
                    onChange={(event) => setFlag(feature.key, event.target.checked)}
                    className="mt-1 h-4 w-4 accent-violet-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{feature.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{feature.description}</span>
                    {dependency && !dependencyEnabled && (
                      <span className="mt-1.5 block text-[11px] font-semibold text-amber-600">Requires physical inventory.</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-[11px] leading-5 text-slate-400">
        Batch/serial tracking automatically enables physical inventory. These rules are also enforced at the database boundary.
      </p>
    </div>
  );
}
