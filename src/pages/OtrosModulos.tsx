import { SectionHeader } from '../components/layout/UI'

export default function OtrosModulos({ title }: { title: string }) {
  return (
    <div style={{ padding: '24px 28px' }}>
      <SectionHeader title={title} subtitle="Modulo en construccion" />
      <div style={{ color: '#555', fontSize: 13, marginTop: 20 }}>
        Este modulo esta en desarrollo.
      </div>
    </div>
  )
}
