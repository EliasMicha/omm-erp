// Existencia de Syscom a la vista (2026-11-14).
//
// Lee syscom_precios (la llena la revisión nocturna) para los productos del
// catálogo que se le pidan. Es la existencia de la última revisión, no en
// vivo: la insignia dice de cuándo es.
//
// Uso: el editor carga el mapa con useExistenciaSyscom(ids) y lo pone en
// <ExistenciaSyscomCtx.Provider>; cada renglón pinta <InsigniaExistencia
// catalogId={...} />. Así no hay que pasar el dato por cuatro niveles.
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { textoExistencia, colorExistencia } from '../../lib/syscom'

export interface InfoSyscom { existencia: number | null; precio_usd: number | null; consultado_at: string | null; link: string | null }

export const ExistenciaSyscomCtx = createContext<Map<string, InfoSyscom>>(new Map())

export function useExistenciaSyscom(catalogIds: Array<string | null | undefined>): Map<string, InfoSyscom> {
  const [mapa, setMapa] = useState<Map<string, InfoSyscom>>(new Map())
  const clave = Array.from(new Set(catalogIds.filter(Boolean) as string[])).sort().join(',')
  useEffect(() => {
    if (!clave) { setMapa(new Map()); return }
    let vivo = true
    ;(async () => {
      const ids = clave.split(',')
      const m = new Map<string, InfoSyscom>()
      for (let k = 0; k < ids.length; k += 200) {
        const { data } = await supabase.from('syscom_precios')
          .select('catalog_product_id, existencia, precio_usd, consultado_at, link, syscom_id')
          .in('catalog_product_id', ids.slice(k, k + 200)).not('syscom_id', 'is', null)
        for (const r of (data || []) as any[]) m.set(r.catalog_product_id, { existencia: r.existencia, precio_usd: r.precio_usd, consultado_at: r.consultado_at, link: r.link })
      }
      if (vivo) setMapa(m)
    })()
    return () => { vivo = false }
  }, [clave])
  return mapa
}

function haceCuanto(iso: string | null): string {
  if (!iso) return ''
  const h = (Date.now() - new Date(iso).getTime()) / 3600000
  if (h < 1) return 'hace menos de una hora'
  if (h < 24) return 'hace ' + Math.round(h) + ' h'
  const d = Math.round(h / 24)
  return 'hace ' + d + (d === 1 ? ' día' : ' días')
}

export function InsigniaExistencia({ catalogId, info: infoDirecta, compacto }: { catalogId?: string | null; info?: InfoSyscom | null; compacto?: boolean }) {
  const mapa = useContext(ExistenciaSyscomCtx)
  const info = infoDirecta ?? (catalogId ? mapa.get(catalogId) : undefined)
  if (!info) return null
  const color = colorExistencia(info.existencia)
  const titulo = `Existencia en Syscom ${haceCuanto(info.consultado_at)}` + (info.precio_usd != null ? ` · costo US$${Number(info.precio_usd).toFixed(2)}` : '')
  return (
    <span title={titulo} style={{ fontSize: compacto ? 9.5 : 9, color, background: color + '18', padding: '1px 5px', borderRadius: 4, whiteSpace: 'nowrap' }}>
      Syscom: {textoExistencia(info.existencia)}
    </span>
  )
}
