import { createAdminClient } from "@/lib/supabase/server";
import type { NormalizedPosition } from "../provider/types";
import type { FleetPersistencePort, VehicleRef } from "../engine/types";

/**
 * Adaptador de persistencia Supabase (service_role) del Tracking Engine.
 *
 * Implementa el PORT FleetPersistencePort. Es el único módulo del tracking que
 * conoce Supabase/tablas; el Engine depende solo del puerto. Usa la service key
 * (bypassa RLS) — coherente con que fleet_positions no tiene policy de insert.
 */

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

export function createSupabasePersistence(
  admin: AdminClient
): FleetPersistencePort {
  return {
    async resolveVehicleByDevice(device: string): Promise<VehicleRef | null> {
      const { data, error } = await admin
        .from("fleet_vehicles")
        .select("id")
        .eq("device_identifier", device)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id as string } : null;
    },

    async insertPosition(
      vehicleId: string,
      pos: NormalizedPosition
    ): Promise<{ positionId: number }> {
      const { data, error } = await admin
        .from("fleet_positions")
        .insert({
          vehicle_id: vehicleId,
          latitude: pos.latitude,
          longitude: pos.longitude,
          speed: pos.speedKmh,
          battery: pos.battery,
          heading: pos.heading,
          accuracy: pos.accuracy,
          recorded_at: pos.recordedAt,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { positionId: Number(data.id) };
    },

    async touchVehicle(vehicleId: string): Promise<void> {
      const { error } = await admin
        .from("fleet_vehicles")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", vehicleId);
      if (error) throw new Error(error.message);
    },
  };
}
