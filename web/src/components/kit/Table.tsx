import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import {
  Table as ShadTable,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from '@/components/ui/Table'
import { cn } from '@/lib/utils'

/**
 * `numeric` is the point of this wrapper. Figures are right-aligned and tabular so digits line up
 * column-wise; labels are left-aligned. Getting that wrong is the difference between a table you
 * can scan and one you have to read.
 */
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <ShadTable className="w-full min-w-[640px] text-left">
        {/* Call sites pass a fragment of <Th> cells, not a row. The <tr> belongs here so no page
            has to remember it — omitting it nests <th> straight inside <thead>, which React
            reports as a hydration-level DOM error. */}
        <TableHeader>
          <TableRow className="border-b border-border bg-surface-2/50 hover:bg-transparent">
            {head}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </ShadTable>
    </div>
  )
}

export function Th({
  children,
  numeric,
  className,
  ...rest
}: { children: ReactNode; numeric?: boolean } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <TableHead
      {...rest}
      scope="col"
      className={cn(
        't-caption h-auto whitespace-nowrap px-3 py-2.5 font-medium text-ink-dim',
        numeric && 'text-right',
        className,
      )}
    >
      {children}
    </TableHead>
  )
}

export function Td({
  children,
  numeric,
  className,
  ...rest
}: { children: ReactNode; numeric?: boolean } & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <TableCell
      {...rest}
      className={cn(
        't-callout whitespace-nowrap px-3 py-2.5',
        numeric && 'num text-right',
        className,
      )}
    >
      {children}
    </TableCell>
  )
}

export { TableRow as Tr } from '@/components/ui/Table'
