export default function NewSectionDivider({ className = '' }) {
  const classes = ['new-section-divider', className].filter(Boolean).join(' ')
  return <div className={classes} aria-hidden="true" />
}
