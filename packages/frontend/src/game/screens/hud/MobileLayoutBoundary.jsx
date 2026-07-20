/**
 * Wrapper-free branch boundary. The desktop child is returned verbatim when mobile mode is false.
 * @param {{ mobile: boolean, mobile_view: import('react').ReactNode, desktop_view: import('react').ReactNode }} props
 */
export function MobileLayoutBoundary({ mobile, mobile_view, desktop_view }) {
  return mobile ? mobile_view : desktop_view
}
