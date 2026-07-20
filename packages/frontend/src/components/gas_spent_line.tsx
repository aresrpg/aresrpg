import { useTranslation } from 'react-i18next'

import { format_gas_spend_sui } from '../tx/gas_spend_ledger'

export function GasSpentLine({ spent_mist }: { spent_mist: bigint }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-1.5 mt-0.5">
      <span className="text-muted text-[9px] tracking-[0.08em]">{t('sponsor.gas_spent_24h')}</span>
      <span className="text-text text-[9px] font-mono tabular-nums whitespace-nowrap">
        {format_gas_spend_sui(spent_mist)} SUI
      </span>
    </div>
  )
}
