import type { AssetView } from '@/hooks/useAssets'

/**
 * A representative clip size per asset, so a page that has just loaded shows a real quote rather
 * than an empty panel or a rounding error. 5,000 units of a ~$1 asset; 100 units of a high-NAV
 * equity, which is the same order of money.
 *
 * The Overview's quote band opened this way from the start; the Holder page now seeds its amount
 * field from the same function, so the two pages can never disagree about what a demo-sized
 * redemption looks like.
 */
export function sampleAmountWad(a: AssetView): bigint {
  return a.navPerToken > 100n * 10n ** 18n ? 100n * 10n ** 18n : 5_000n * 10n ** 18n
}

/** The same figure as an input-field string: plain digits, no grouping. */
export function sampleAmountInput(a: AssetView): string {
  return (sampleAmountWad(a) / 10n ** 18n).toString()
}

/**
 * The asset a page should open on: the eligible one carrying the largest credit premium, because
 * that is the quote whose four terms are all visible at once. Overview and Holder use the same
 * rule, so moving between them does not silently change the subject.
 */
export function defaultAsset(assets: AssetView[]): AssetView | undefined {
  if (assets.length === 0) return undefined
  const loudest = [...assets]
    .filter((a) => a.eligible && a.enabled)
    .sort((x, y) => Number(y.creditBps - x.creditBps))[0]
  return loudest ?? assets[0]
}
