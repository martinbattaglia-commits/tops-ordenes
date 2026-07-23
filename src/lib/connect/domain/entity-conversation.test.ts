import { describe, it, expect } from "vitest";
import {
  isConnectEntityType, usesTextPk, erpEntityHref, contextualConversationHref,
} from "./entity-conversation";

describe("connect/domain/entity-conversation", () => {
  it("valida el vocabulario de entity_type", () => {
    expect(isConnectEntityType("orders")).toBe(true);
    expect(isConnectEntityType("compliance_items")).toBe(true);
    expect(isConnectEntityType("foo")).toBe(false);
    expect(isConnectEntityType(null)).toBe(false);
  });
  it("compliance_items usa PK text", () => {
    expect(usesTextPk("compliance_items")).toBe(true);
    expect(usesTextPk("orders")).toBe(false);
  });
  it("erpEntityHref mapea a la ruta del módulo", () => {
    expect(erpEntityHref("orders", "abc")).toBe("/orders/abc");
    expect(erpEntityHref("purchase_orders", "po1")).toBe("/compras/ordenes/po1");
    expect(erpEntityHref("vendors", "v1")).toBe("/compras/proveedores");
  });
  it("contextualConversationHref arma el deep-link", () => {
    expect(contextualConversationHref("orders", "abc")).toBe("/connect/e/orders/abc");
    expect(contextualConversationHref("compliance_items", "MAG-04")).toBe("/connect/e/compliance_items/MAG-04");
  });
});
