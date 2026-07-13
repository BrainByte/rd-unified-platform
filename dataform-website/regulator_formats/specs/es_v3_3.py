# ============================================================================
# ES — DGOJ Sistema de Monitorización v3.3 as a MAPPING SPEC (pure data).
#
# Declares what regulator_formats/es.py does imperatively, in the binding
# vocabulary of engine.py. The small UPPER-CASE constructors below only
# assemble repeated DGOJ house patterns (Importe line-lists, Total+Desglose
# breakdowns, registro Cabeceras) into dict literals — they run once at
# import and hold no runtime logic, the same way jurisdictions.js uses JS
# helpers to shape its config.
#
# Proven byte-identical to the hand-written oracle es.py by
# dataform-website/test_es_spec.py. Schema source:
# docs/regulator/es/DGOJ_Monitorizacion_3.3.xsd; design rationale:
# docs/regulator/translation-architecture.md (Option A).
#
# Demo defaults carried over from es.py: pseudonymised players mean RUD
# identity blocks are omitted; the website captures no IP/device, so those
# mandatory surveillance fields carry declared placeholders.
# ============================================================================

_IP = {"const": "0.0.0.0"}
_DISPOSITIVO = {"const": "PC"}
_ID_DISPOSITIVO = {"const": "demo-web"}


def _IMPORTE(field=None):
    """<Importe> as (Cantidad, Unidad) lines; no field (or absent field at
    serialisation time) -> empty element = zero."""
    if field is None:
        return {"children": {}}
    return {"children": {"Linea": {
        "when": {"field": field, "present": True},
        "children": {"Cantidad": {"from": field, "as": "money"},
                     "Unidad": {"const": "EUR"}},
    }}}


def _DESGLOSE(field=None):
    """The Total+Desglose breakdown pattern with an Importe total."""
    return {"children": {"Total": _IMPORTE(field)}}


def _CABECERA(registro_id, fecha):
    """The RegistroCabecera every Registro opens with (single subregistro)."""
    return {"children": {
        "RegistroId": registro_id,
        "SubregistroId": {"const": "1"},
        "SubregistroTotal": {"const": "1"},
        "Fecha": fecha,
    }}


def _PERIODO(periodicidad, field, codec):
    """RegistroPeriodicoBase: Periodicidad + Periodo/Dia-or-Mes."""
    unit = "Mes" if periodicidad == "Mensual" else "Dia"
    return {"Periodicidad": {"const": periodicidad},
            "Periodo": {"children": {unit: {"from": field, "as": codec}}}}


# One CJD Jugador block, shared by the payments record and the periodic
# filings: the CJD shape demands every money category, so categories the
# record has nothing for resolve to empty (zero) totals — a single payment
# carries no stake_sum, a register row carries no direction, and the
# variant/when bindings fall through to the empty shapes accordingly.
_OPERACION = {
    "Fecha": {"from": "completed_at", "as": "digits14tz"},
    "Importe": {"from": "amount", "as": "money"},
    "MedioPago": {"from": "method", "fallback": "OTRO"},
    "TipoMedioPago": {"from": "method", "map": {"CARD": "1"}, "default": "99"},
    "TitularidadVerificada": {"const": "S"},
    "ResultadoOperacion": {"const": "OK"},
    "IP": _IP,
    "Dispositivo": _DISPOSITIVO,
    "IdDispositivo": _ID_DISPOSITIVO,
}

_CJD_JUGADOR = {"children": {
    "JugadorId": {"from": "player_ref"},
    "SaldoInicial": _IMPORTE(),
    "Depositos": [
        {"when": {"field": "direction", "equals": "DEPOSIT"},
         "children": {"Total": {"from": "amount", "as": "money"},
                      "Operaciones": {"children": _OPERACION}}},
        {"children": {"Total": {"const": "0.00"}}},
    ],
    "Retiradas": [
        {"when": {"field": "direction", "equals": "WITHDRAWAL"},
         "children": {"Total": {"from": "amount", "as": "money"},
                      "Operaciones": {"children": _OPERACION}}},
        {"children": {"Total": {"const": "0.00"}}},
    ],
    "Participacion": _DESGLOSE("stake_sum"),
    "ParticipacionDevolucion": _DESGLOSE(),
    "Premios": _DESGLOSE("winnings_sum"),
    "AjustePremios": _DESGLOSE(),
    "Trans_IN": _DESGLOSE(),
    "Trans_OUT": _DESGLOSE(),
    "Otros": _DESGLOSE(),
    "SaldoFinal": _IMPORTE(),
    "Cuentas": {"children": {"Cuenta": {"from": "player_ref"},
                             "SaldoFinal": _IMPORTE()}},
    "Comision": _DESGLOSE(),
    "Bonos": _DESGLOSE(),
}}


SPEC = {
    "market": "ES",
    "schema_version": "3.3",

    "config": {
        "operador_id": "BNV",        # DGOJ-assigned operator code (<= 4 chars)
        "almacen_id": "BNVSAFE1",    # data-warehouse id (<= 10 chars)
    },

    # every DGOJ submission is a <Lote>: batch header + xsi-typed Registros
    "envelope": {
        "root": "Lote",
        "attrs": {"xmlns": "http://cnjuego.gob.es/sci/v3.3.xsd",
                  "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"},
        "header": {"element": "Cabecera", "fields": {
            "OperadorId": {"config": "operador_id"},
            "AlmacenId": {"config": "almacen_id"},
            "LoteId": {"defer": "lote_id"},      # each record type names its batch
            "Version": {"const": "3.3"},
        }},
    },

    "records": {

        # one settled fixed-odds bet (ES never reports voids — suppressed
        # upstream, so ParticipacionDevolucion is always the empty Importe)
        "bets": {
            "lote_id": {"format": "LOTE-ADC-{slip_id}"},
            "registros": [{
                "element": "Registro",
                "attrs": {"xsi:type": "RegistroApuestaContrapartida"},
                "fields": {
                    "Cabecera": _CABECERA({"from": "slip_id"},
                                          {"from": "terminal_at", "as": "digits14"}),
                    "Juego": {"children": {
                        "JuegoId": {"from": "slip_id"},
                        "JuegoDesc": {"from": "event"},
                        "TipoJuego": {"const": "ADC"},
                        "FechaInicio": {"from": "placed_at", "as": "digits14tz"},
                        "FechaFin": {"from": "terminal_at", "as": "digits14tz"},
                        "EnDirecto": {"const": "N"},
                        "TipoApuesta": {"const": "Simple"},
                        "NumeroEventos": {"const": "1"},
                        "Eventos": {"children": {
                            "EventoId": {"from": "fixture_id"},
                            "Hecho": {"format": "1X2: {selection}"},
                            "FechaHecho": {"from": "terminal_at", "as": "digits14tz"},
                        }},
                    }},
                    "Jugador": {"children": {
                        "JugadorId": {"from": "player_ref"},
                        "Participacion": _IMPORTE("stake"),
                        "ParticipacionDevolucion": _IMPORTE(),
                        "Premios": _IMPORTE("payout"),
                        "IP": _IP,
                        "Dispositivo": _DISPOSITIVO,
                        "IdDispositivo": _ID_DISPOSITIVO,
                        "TicketApuesta": {"from": "slip_id"},
                        "Cuota": {"from": "odds", "as": "money4"},
                    }},
                },
            }],
        },

        # one completed deposit/withdrawal as a daily RegistroCJD carrying
        # the operation with its payment-method detail
        "payments": {
            "lote_id": {"format": "LOTE-CJD-{payment_id}"},
            "registros": [{
                "element": "Registro", "attrs": {"xsi:type": "RegistroCJD"},
                "fields": {
                    "Cabecera": _CABECERA({"from": "payment_id"},
                                          {"from": "completed_at", "as": "digits14"}),
                    **_PERIODO("Diaria", "completed_at", "digits8"),
                    "Jugador": _CJD_JUGADOR,
                },
            }],
        },

        # a (re-)reported player as a RegistroRUD with one Jugador block;
        # identity/limits/verification detail omitted — the demo holds only
        # a pseudonym, never the identity the real RUD requires
        "players": {
            "lote_id": {"format": "LOTE-RUD-{player_ref:.12}-{kyc_status}"},
            "registros": [{
                "element": "Registro", "attrs": {"xsi:type": "RegistroRUD"},
                "fields": {
                    "Cabecera": _CABECERA({"format": "RUD-{player_ref:.32}"},
                                          {"from": "opened_at", "as": "digits14"}),
                    **_PERIODO("Diaria", "opened_at", "digits8"),
                    "Jugador": {"children": {
                        "JugadorId": {"from": "player_ref"},
                        "FechaActivacion": {"from": "opened_at", "as": "digits14"},
                        "CambiosEnDatos": {"from": "kyc_status",
                                           "map": {"PENDING": "A"}, "default": "S"},
                        "RegionFiscal": {"const": "01"},
                    }},
                },
            }],
        },

        # one casino round as a RegistroOtrosJuegos: a single Juego block
        # for the game type plus the session it belonged to
        "gaming": {
            "lote_id": {"format": "LOTE-OJU-{round_id}"},
            "registros": [{
                "element": "Registro", "attrs": {"xsi:type": "RegistroOtrosJuegos"},
                "fields": {
                    "Cabecera": _CABECERA({"from": "round_id"},
                                          {"from": "played_at", "as": "digits14"}),
                    "Juego": {"children": {
                        "JuegoId": {"from": "round_id"},
                        "JuegoDesc": {"from": "game"},
                        "TipoJuego": {"from": "game",
                                      "map": {"SLOTS": "AZA", "BLACKJACK": "BLJ",
                                              "POKER": "POC", "operator-jackpots": "AZA"},
                                      "default": "AZA"},
                        "FechaInicio": {"from": "played_at", "as": "digits14tz"},
                        "FechaFin": {"from": "played_at", "as": "digits14tz"},
                        "Participacion": _IMPORTE("stake"),
                        "ParticipacionDevolucion": _IMPORTE(),
                        "Premios": _IMPORTE("payout"),
                        "Botes": _DESGLOSE(),
                        "PartidasJugadas": {"const": "1"},
                    }},
                    "Jugador": {"children": {
                        "JugadorId": {"from": "player_ref"},
                        "Sesion": {"children": {
                            "SesionId": {"from": "session_id", "fallback_field": "round_id"},
                            "FechaInicioSesion": {"from": "played_at", "as": "digits14tz"},
                            "FechaFinSesion": {"from": "played_at", "as": "digits14tz"},
                            "FechaInicioPrimerJuego": {"from": "played_at", "as": "digits14tz"},
                            "FechaFinUltimoJuego": {"from": "played_at", "as": "digits14tz"},
                            "PlanificacionSesion": {"children": {
                                "DuracionLimite": {"const": "240000"},   # no session plan in the demo
                                "GastoLimite": {"const": "0.00"},
                                "PeriodoExclusion": {"const": "N"},
                            }},
                            "SesionCompleta": {"const": "S"},
                            "SesionNueva": {"const": "S"},
                            "MotivoFinSesion": {"const": "Usuario"},
                        }},
                        "IP": _IP,
                        "Dispositivo": _DISPOSITIVO,
                        "IdDispositivo": _ID_DISPOSITIVO,
                    }},
                },
            }],
        },

        # the daily register filing: ONE Lote holding a RegistroRUD (who was
        # active) and a RegistroCJD Diaria (their settled betting money) —
        # one submission row-set fanning out into two regulator registers
        "rud": {
            "lote_id": {"format": "LOTE-RUD-{period_start:%Y%m%d}"},
            "registros": [
                {"element": "Registro", "attrs": {"xsi:type": "RegistroRUD"},
                 "fields": {
                     "Cabecera": _CABECERA({"format": "RUD-{period_start:%Y%m%d}"},
                                           {"from": "period_start", "as": "digits14"}),
                     **_PERIODO("Diaria", "period_start", "digits8"),
                     "Jugador": {"each": "rows", "children": {
                         "JugadorId": {"from": "player_ref"},
                         "FechaActivacion": {"from": "opened_at", "as": "digits14"},
                         "CambiosEnDatos": {"const": "N"},
                         "RegionFiscal": {"const": "01"},
                     }},
                 }},
                {"element": "Registro", "attrs": {"xsi:type": "RegistroCJD"},
                 "fields": {
                     "Cabecera": _CABECERA({"format": "CJD-{period_start:%Y%m%d}"},
                                           {"from": "period_start", "as": "digits14"}),
                     **_PERIODO("Diaria", "period_start", "digits8"),
                     "Jugador": {"each": "rows", **_CJD_JUGADOR},
                 }},
            ],
        },

        # the monthly register filing: RegistroRUT totals (counts, as the
        # real RUT is) plus a RegistroCJD Mensual with the per-player sums
        "rut": {
            "lote_id": {"format": "LOTE-RUT-{period_start:%Y%m}"},
            "registros": [
                {"element": "Registro", "attrs": {"xsi:type": "RegistroRUT"},
                 "fields": {
                     "Cabecera": _CABECERA({"format": "RUT-{period_start:%Y%m}"},
                                           {"from": "period_start", "as": "digits14"}),
                     "Mes": {"from": "period_start", "as": "digits6"},
                     "NumeroJugadores": {"count": "rows"},
                     "NumeroAltas": {"const": "0"},
                     "NumeroBajas": {"const": "0"},
                     "NumeroActividad": {"count": "rows"},
                     "NumeroTest": {"const": "0"},
                     "NumeroJugadoresPorEstado": {"children": {
                         "EstadoCNJ": {"const": "A"},
                         "Numero": {"count": "rows"},
                     }},
                 }},
                {"element": "Registro", "attrs": {"xsi:type": "RegistroCJD"},
                 "fields": {
                     "Cabecera": _CABECERA({"format": "CJD-{period_start:%Y%m}"},
                                           {"from": "period_start", "as": "digits14"}),
                     **_PERIODO("Mensual", "period_start", "digits6"),
                     "Jugador": {"each": "rows", **_CJD_JUGADOR},
                 }},
            ],
        },
    },
}
