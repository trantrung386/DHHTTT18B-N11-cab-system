import { create } from 'zustand';

export interface LocationData {
  lat: number;
  lng: number;
  address: string;
}

export interface RideData {
  id: string;
  customerName: string;
  customerPhone?: string;
  pickup: LocationData;
  dropoff: LocationData;
  distanceKm: number;
  price: number;
  etaToPickup?: number;
}

export type DriverStatus = 'OFFLINE' | 'ONLINE';
export type RideStatus = 'IDLE' | 'INCOMING' | 'PICKING_UP' | 'IN_PROGRESS' | 'COMPLETED';

interface DriverState {
  isOnline: boolean;
  currentLocation: { lat: number; lng: number } | null;
  status: DriverStatus;
  rideStatus: RideStatus;
  activeRide: RideData | null;
  rideRoutePath: [number, number][];  // Cached pickup→dropoff route for the active ride
  
  // Actions
  toggleOnline: () => void;
  setCurrentLocation: (lat: number, lng: number) => void;
  setIncomingRide: (ride: RideData) => void;
  setRideRoutePath: (path: [number, number][]) => void;
  acceptRide: () => void;
  declineRide: () => void;
  markAsPickedUp: () => void;
  completeRide: () => void;
  resetRide: () => void;
}

export const useDriverStore = create<DriverState>((set) => ({
  isOnline: false,
  currentLocation: null,
  status: 'OFFLINE',
  rideStatus: 'IDLE',
  activeRide: null,
  rideRoutePath: [],
  
  toggleOnline: () => set((state) => {
    const newStatus = !state.isOnline;
    return { isOnline: newStatus, status: newStatus ? 'ONLINE' : 'OFFLINE' };
  }),
  
  setCurrentLocation: (lat, lng) => set({ currentLocation: { lat, lng } }),
  
  setIncomingRide: (ride) => set({ activeRide: ride, rideStatus: 'INCOMING', rideRoutePath: [] }),
  
  setRideRoutePath: (path) => set({ rideRoutePath: path }),
  
  acceptRide: () => set({ rideStatus: 'PICKING_UP' }),
  
  declineRide: () => set({ activeRide: null, rideStatus: 'IDLE', rideRoutePath: [] }),
  
  markAsPickedUp: () => set({ rideStatus: 'IN_PROGRESS' }),
  
  completeRide: () => set({ rideStatus: 'COMPLETED' }),
  
  resetRide: () => set({ activeRide: null, rideStatus: 'IDLE', rideRoutePath: [] })
}));
