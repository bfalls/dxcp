import React from 'react'

export default function SectionCard({ children, className = '', ...props }) {
  const classes = ['card', 'section-card', className].filter(Boolean).join(' ')
  return (
    <section className={classes} {...props}>
      {children}
    </section>
  )
}
