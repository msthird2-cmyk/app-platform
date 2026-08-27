import { createContext, useContext, type ReactNode } from 'react';
import { Button } from '@platform/ui';

/**
 * The "pair a new device" affordance, on the trusted-device path.
 *
 * A context rather than a prop threaded through every screen, because the
 * button belongs wherever an application puts its account settings and the gate
 * is the only thing that knows whether pairing is possible at all. `available`
 * is false whenever no relay was injected, and the button then renders nothing
 * — pairing is not offered as a capability that does not exist.
 */
export interface PairDevice {
  available: boolean;
  begin: () => void;
}

const PairDeviceContext = createContext<PairDevice>({ available: false, begin: () => undefined });

export function PairDeviceProvider({
  value,
  children,
}: {
  value: PairDevice;
  children: ReactNode;
}) {
  return <PairDeviceContext.Provider value={value}>{children}</PairDeviceContext.Provider>;
}

export function usePairDevice(): PairDevice {
  return useContext(PairDeviceContext);
}

export interface PairNewDeviceButtonProps {
  label?: string;
}

/** Renders nothing when no relay is wired. There is no disabled state to show. */
export function PairNewDeviceButton({ label = 'Pair a new device' }: PairNewDeviceButtonProps) {
  const { available, begin } = usePairDevice();
  if (!available) return null;
  return <Button label={label} variant="secondary" onPress={begin} />;
}
