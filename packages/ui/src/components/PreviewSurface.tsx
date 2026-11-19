import { createContext, type ReactNode } from 'react'

/** The workshop changes only dialog hosting, never its content or data controller. */
export const PreviewContext = createContext(false)
export const PreviewSurface = ({ children }: Readonly<{ children: ReactNode }>) => (
  <PreviewContext.Provider value={true}>
    <div className="aui-preview-surface">{children}</div>
  </PreviewContext.Provider>
)
