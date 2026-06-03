/**
 * Tipos de dominio de Picking (GATE 4A).
 *
 * El picking avanza reservas 'reservada' ↔ 'pickeada' (RPC de 0032). Esta capa
 * SOLO lee la cola/ruta y envuelve las RPC; NO toca stock (ver picking.ts).
 *
 * UBICACIÓN FÍSICA CANÓNICA (decisión Gate 4A): `PhysicalLocation` expone la
 * jerarquía completa depósito → piso → sector → zona/pasillo → rack → nivel →
 * posición. Es la FUENTE ESTÁNDAR reutilizable por Gate 4B (Packing) y Gate 4C
 * (Despacho); esos gates deben consumir esta misma forma y NO introducir
 * consultas alternativas de ubicación.
 */

import type { AllocStatus, LogisticsOrderStatus } from "@/lib/pedidos/types";

export type { AllocStatus } from "@/lib/pedidos/types";

/**
 * Ubicación física completa de una parada de picking. Derivada de
 * warehouse_positions → racks → zones → sectors → floors → warehouses
 * (misma cadena que el Digital Twin / inventario).
 */
export interface PhysicalLocation {
  warehouse_code: string | null; // depósito (sede)
  warehouse_name: string | null;
  floor_code: string | null; // piso
  floor_level: number | null; // orden vertical del piso (0 = PB)
  sector_code: string | null; // sector
  zone_code: string | null; // zona / pasillo
  rack_code: string | null; // rack
  rack_level: number | null; // nivel (altura del rack)
  rack_column: number | null; // columna
  position_code: string | null; // posición (hoja)
  position_id: string | null; // clave de integración (warehouse_positions.id)
  /** Ruta legible canónica: 'WH·FLOOR·SECTOR·ZONE·RACK·POSITION'. */
  full_code: string | null;
}

/** Fila de la cola de picking: un pedido en preparación con paradas pendientes. */
export interface PickQueueRow {
  order_id: string;
  public_id: string;
  client_name: string;
  status: LogisticsOrderStatus; // siempre 'en_preparacion' en 4A
  priority: number;
  requested_date: string | null;
  /** Líneas del pedido. */
  line_count: number;
  /** Paradas aún por pickear (allocations 'reservada'). */
  pending_stops: number;
  /** Paradas ya pickeadas (allocations 'pickeada'). */
  picked_stops: number;
  /** Paradas vivas = pending + picked (allocations no liberadas). */
  total_stops: number;
  /** true si no quedan paradas 'reservada' (todo el pedido pickeado). */
  fully_picked: boolean;
}

/** Una parada de la ruta: una allocation (ítem + lote + posición + cantidad). */
export interface PickStop {
  allocation_id: string;
  status: AllocStatus; // 'reservada' (por pickear) | 'pickeada' (ya retirada)
  order_item_id: string;
  sku: string;
  description: string;
  lot_number: string | null;
  quantity: number;
  inventory_item_id: string;
  location: PhysicalLocation;
}

/** Ruta de picking de un pedido: cabecera + paradas ordenadas por ubicación. */
export interface PickRoute {
  order_id: string;
  public_id: string;
  client_name: string;
  status: LogisticsOrderStatus;
  /** Prioridad del pedido (mayor = antes). Se mapea a Alta/Normal/Baja en la UI;
   *  deja preparada la evolución del recorrido y la futura incorporación de waves. */
  priority: number;
  stops: PickStop[];
}
