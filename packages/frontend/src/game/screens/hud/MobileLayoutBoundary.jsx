// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/**
 * Wrapper-free branch boundary. The desktop child is returned verbatim when mobile mode is false.
 * @param {{ mobile: boolean, mobile_view: import('react').ReactNode, desktop_view: import('react').ReactNode }} props
 */
export function MobileLayoutBoundary({ mobile, mobile_view, desktop_view }) {
  return mobile ? mobile_view : desktop_view
}
