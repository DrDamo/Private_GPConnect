import type { AnchorHTMLAttributes } from 'react'
import { navigate } from './router'

export default function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={e => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(href)
        window.scrollTo(0, 0)
      }}
      {...rest}
    />
  )
}
