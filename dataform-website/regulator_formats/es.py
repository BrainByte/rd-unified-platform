# ============================================================================
# ES — DGOJ Sistema de Monitorización v3.3 (docs/regulator/es).
#
# Everything the DGOJ receives is a <Lote> (batch): a four-field Cabecera
# (operator, warehouse, batch id, version) plus polymorphic <Registro>
# elements whose concrete class is asserted with xsi:type. The lexical
# conventions are the schema's own: digit-string dates (AAAAMMDDHHMMSS,
# with ±HHMM offset where the type is the TZ variant), S/N booleans, and
# every money figure as an <Importe> list of (Cantidad, Unidad) lines.
#
# Mapping choices (the "complex translation" this layer absorbs):
#   bets     -> RegistroApuestaContrapartida (ADC), one Lote per settled bet
#   payments -> RegistroCJD (daily player account movements) carrying the
#               one operation with its payment-method detail
#   players  -> RegistroRUD with one Jugador block (the player register)
#   gaming   -> RegistroOtrosJuegos, one Juego block + the session
#   rud      -> ONE Lote per filing: RegistroRUD (who was active) plus
#               RegistroCJD Diaria (their money movements) — a submission
#               row-set fans out into two regulator registers
#   rut      -> ONE Lote per filing: RegistroRUT (register totals — counts,
#               as the real RUT is) plus RegistroCJD Mensual (per-player
#               monthly sums, which is where DGOJ actually wants amounts)
#
# Demo defaults, stated once: the demo pseudonymises Spanish players (sha256
# national id), so RUD identity blocks (name, DNI/NIE, address...) are
# omitted; the website captures no IP/device, so those mandatory
# surveillance fields carry declared placeholders.
# ============================================================================
import xml.etree.ElementTree as ET

from ._util import el, money2, utc

XSI = "http://www.w3.org/2001/XMLSchema-instance"
NS = "http://cnjuego.gob.es/sci/v3.3.xsd"
OPERATOR_ID = "BNV"        # DGOJ-assigned operator code (<= 4 chars)
ALMACEN_ID = "BNVSAFE1"    # data-warehouse id (<= 10 chars)
VERSION = "3.3"
CURRENCY = "EUR"
IP_PLACEHOLDER = "0.0.0.0"     # demo website captures no client IP
DEVICE = ("PC", "demo-web")    # TipoDispositivo + IdDispositivo placeholders

# demo game -> TipoJuego "otros juegos" code
_TIPO_JUEGO = {"SLOTS": "AZA", "BLACKJACK": "BLJ", "POKER": "POC",
               "operator-jackpots": "AZA"}


def _fecha(dt, tz_suffix=False):
    """AAAAMMDDHHMMSS digit-string; the TZ variant appends +0000 (UTC)."""
    return utc(dt).strftime("%Y%m%d%H%M%S") + ("+0000" if tz_suffix else "")


def _dia(dt):
    return utc(dt).strftime("%Y%m%d")


def _mes(dt):
    return utc(dt).strftime("%Y%m")


def _importe(parent, name, amount=None):
    """<Importe> as a list of (Cantidad, Unidad) lines; no lines = zero."""
    imp = el(parent, name)
    if amount is not None:
        linea = el(imp, "Linea")
        el(linea, "Cantidad", money2(amount))
        el(linea, "Unidad", CURRENCY)
    return imp


def _desglose(parent, name, total=None):
    """The Total+Desglose breakdown pattern with an Importe total."""
    des = el(parent, name)
    _importe(des, "Total", total)
    return des


def _lote(lote_id):
    root = ET.Element("Lote", {"xmlns": NS, "xmlns:xsi": XSI})
    cab = el(root, "Cabecera")
    el(cab, "OperadorId", OPERATOR_ID)
    el(cab, "AlmacenId", ALMACEN_ID)
    el(cab, "LoteId", lote_id)
    el(cab, "Version", VERSION)
    return root


def _registro(lote, xsi_type, registro_id, fecha):
    reg = el(lote, "Registro", **{"xsi:type": xsi_type})
    cab = el(reg, "Cabecera")
    el(cab, "RegistroId", registro_id)
    el(cab, "SubregistroId", "1")
    el(cab, "SubregistroTotal", "1")
    el(cab, "Fecha", _fecha(fecha))
    return reg


def _periodico(reg, periodicidad, period_dt):
    """The RegistroPeriodicoBase fields (Periodicidad + Periodo)."""
    el(reg, "Periodicidad", periodicidad)
    periodo = el(reg, "Periodo")
    if periodicidad == "Mensual":
        el(periodo, "Mes", _mes(period_dt))
    else:
        el(periodo, "Dia", _dia(period_dt))


def bet(rec):
    """One settled fixed-odds bet as a RegistroApuestaContrapartida (ADC).
    ES never reports voids (suppressed upstream), so ParticipacionDevolucion
    is always zero here."""
    lote = _lote(f"LOTE-ADC-{rec['slip_id']}")
    reg = _registro(lote, "RegistroApuestaContrapartida", rec["slip_id"], rec["terminal_at"])
    juego = el(reg, "Juego")
    el(juego, "JuegoId", rec["slip_id"])
    el(juego, "JuegoDesc", rec["event"])
    el(juego, "TipoJuego", "ADC")
    el(juego, "FechaInicio", _fecha(rec["placed_at"], tz_suffix=True))
    el(juego, "FechaFin", _fecha(rec["terminal_at"], tz_suffix=True))
    el(juego, "EnDirecto", "N")
    el(juego, "TipoApuesta", "Simple")
    el(juego, "NumeroEventos", "1")
    evento = el(juego, "Eventos")
    el(evento, "EventoId", rec["fixture_id"])
    el(evento, "Hecho", f"1X2: {rec['selection']}")
    el(evento, "FechaHecho", _fecha(rec["terminal_at"], tz_suffix=True))
    jugador = el(reg, "Jugador")
    el(jugador, "JugadorId", rec["player_ref"])
    _importe(jugador, "Participacion", rec["stake"])
    _importe(jugador, "ParticipacionDevolucion")
    _importe(jugador, "Premios", rec["payout"])
    el(jugador, "IP", IP_PLACEHOLDER)
    el(jugador, "Dispositivo", DEVICE[0])
    el(jugador, "IdDispositivo", DEVICE[1])
    el(jugador, "TicketApuesta", rec["slip_id"])
    el(jugador, "Cuota", f"{float(rec['odds']):.4f}")
    return lote


def _cjd_jugador(parent, player_ref, deposit=None, withdrawal=None,
                 stakes=None, winnings=None):
    """One CJD Jugador block. The CJD shape demands every money category;
    categories the record has nothing for carry empty (zero) totals."""
    jug = el(parent, "Jugador")
    el(jug, "JugadorId", player_ref)
    _importe(jug, "SaldoInicial")
    for name, op in (("Depositos", deposit), ("Retiradas", withdrawal)):
        des = el(jug, name)
        el(des, "Total", money2(op["amount"] if op else 0))
        if op:
            oper = el(des, "Operaciones")
            el(oper, "Fecha", _fecha(op["completed_at"], tz_suffix=True))
            el(oper, "Importe", money2(op["amount"]))
            el(oper, "MedioPago", op["method"] or "OTRO")
            el(oper, "TipoMedioPago", "1" if op["method"] == "CARD" else "99")
            el(oper, "TitularidadVerificada", "S")
            el(oper, "ResultadoOperacion", "OK")
            el(oper, "IP", IP_PLACEHOLDER)
            el(oper, "Dispositivo", DEVICE[0])
            el(oper, "IdDispositivo", DEVICE[1])
    _desglose(jug, "Participacion", stakes)
    _desglose(jug, "ParticipacionDevolucion")
    _desglose(jug, "Premios", winnings)
    _desglose(jug, "AjustePremios")
    _desglose(jug, "Trans_IN")
    _desglose(jug, "Trans_OUT")
    _desglose(jug, "Otros")
    _importe(jug, "SaldoFinal")
    cuenta = el(jug, "Cuentas")
    el(cuenta, "Cuenta", player_ref)
    _importe(cuenta, "SaldoFinal")
    _desglose(jug, "Comision")
    _desglose(jug, "Bonos")
    return jug


def payment(rec):
    """One completed deposit/withdrawal as a daily RegistroCJD carrying the
    operation with its payment-method detail."""
    lote = _lote(f"LOTE-CJD-{rec['payment_id']}")
    reg = _registro(lote, "RegistroCJD", rec["payment_id"], rec["completed_at"])
    _periodico(reg, "Diaria", rec["completed_at"])
    op = {"amount": rec["amount"], "completed_at": rec["completed_at"],
          "method": rec["method"]}
    _cjd_jugador(reg, rec["player_ref"],
                 deposit=op if rec["direction"] == "DEPOSIT" else None,
                 withdrawal=op if rec["direction"] == "WITHDRAWAL" else None)
    return lote


def player(rec):
    """A (re-)reported player as a RegistroRUD with one Jugador block.
    Identity, limits and verification detail are omitted: the demo holds
    only a pseudonym (sha256 of the national id), never the identity the
    real RUD requires."""
    lote = _lote(f"LOTE-RUD-{rec['player_ref'][:12]}-{rec['kyc_status']}")
    reg = _registro(lote, "RegistroRUD", f"RUD-{rec['player_ref'][:32]}", rec["opened_at"])
    _periodico(reg, "Diaria", rec["opened_at"])
    jug = el(reg, "Jugador")
    el(jug, "JugadorId", rec["player_ref"])
    el(jug, "FechaActivacion", _fecha(rec["opened_at"]))
    el(jug, "CambiosEnDatos", "A" if rec["kyc_status"] == "PENDING" else "S")
    el(jug, "RegionFiscal", "01")
    return lote


def gaming(rec):
    """One casino round as a RegistroOtrosJuegos: a single Juego block for
    the game type plus the session it belonged to."""
    lote = _lote(f"LOTE-OJU-{rec['round_id']}")
    reg = _registro(lote, "RegistroOtrosJuegos", rec["round_id"], rec["played_at"])
    juego = el(reg, "Juego")
    el(juego, "JuegoId", rec["round_id"])
    el(juego, "JuegoDesc", rec["game"])
    el(juego, "TipoJuego", _TIPO_JUEGO.get(rec["game"], "AZA"))
    el(juego, "FechaInicio", _fecha(rec["played_at"], tz_suffix=True))
    el(juego, "FechaFin", _fecha(rec["played_at"], tz_suffix=True))
    _importe(juego, "Participacion", rec["stake"])
    _importe(juego, "ParticipacionDevolucion")
    _importe(juego, "Premios", rec["payout"])
    _desglose(juego, "Botes")
    el(juego, "PartidasJugadas", "1")
    jugador = el(reg, "Jugador")
    el(jugador, "JugadorId", rec["player_ref"])
    sesion = el(jugador, "Sesion")
    session_id = rec.get("session_id") or rec["round_id"]
    el(sesion, "SesionId", session_id)
    for campo in ("FechaInicioSesion", "FechaFinSesion",
                  "FechaInicioPrimerJuego", "FechaFinUltimoJuego"):
        el(sesion, campo, _fecha(rec["played_at"], tz_suffix=True))
    plan = el(sesion, "PlanificacionSesion")
    el(plan, "DuracionLimite", "240000")   # demo players set no session plan
    el(plan, "GastoLimite", "0.00")
    el(plan, "PeriodoExclusion", "N")
    el(sesion, "SesionCompleta", "S")
    el(sesion, "SesionNueva", "S")
    el(sesion, "MotivoFinSesion", "Usuario")
    el(jugador, "IP", IP_PLACEHOLDER)
    el(jugador, "Dispositivo", DEVICE[0])
    el(jugador, "IdDispositivo", DEVICE[1])
    return lote


def periodic_rud(rec):
    """The daily register filing: ONE Lote holding a RegistroRUD (the
    players active that day) and a RegistroCJD Diaria (their settled
    betting money, as Participacion/Premios per player)."""
    day = rec["period_start"]
    lote = _lote(f"LOTE-RUD-{_dia(day)}")
    rud = _registro(lote, "RegistroRUD", f"RUD-{_dia(day)}", day)
    _periodico(rud, "Diaria", day)
    for row in rec["rows"]:
        jug = el(rud, "Jugador")
        el(jug, "JugadorId", row["player_ref"])
        el(jug, "FechaActivacion", _fecha(row["opened_at"]))
        el(jug, "CambiosEnDatos", "N")
        el(jug, "RegionFiscal", "01")
    cjd = _registro(lote, "RegistroCJD", f"CJD-{_dia(day)}", day)
    _periodico(cjd, "Diaria", day)
    for row in rec["rows"]:
        _cjd_jugador(cjd, row["player_ref"],
                     stakes=row["stake_sum"], winnings=row["winnings_sum"])
    return lote


def periodic_rut(rec):
    """The monthly register filing: ONE Lote holding a RegistroRUT (register
    totals — the real RUT carries counts, not amounts) and a RegistroCJD
    Mensual (the per-player monthly sums the demo register is built from)."""
    month = rec["period_start"]
    rows = rec["rows"]
    lote = _lote(f"LOTE-RUT-{_mes(month)}")
    rut = _registro(lote, "RegistroRUT", f"RUT-{_mes(month)}", month)
    el(rut, "Mes", _mes(month))
    el(rut, "NumeroJugadores", str(len(rows)))
    el(rut, "NumeroAltas", "0")
    el(rut, "NumeroBajas", "0")
    el(rut, "NumeroActividad", str(len(rows)))
    el(rut, "NumeroTest", "0")
    estado = el(rut, "NumeroJugadoresPorEstado")
    el(estado, "EstadoCNJ", "A")
    el(estado, "Numero", str(len(rows)))
    cjd = _registro(lote, "RegistroCJD", f"CJD-{_mes(month)}", month)
    _periodico(cjd, "Mensual", month)
    for row in rows:
        _cjd_jugador(cjd, row["player_ref"],
                     stakes=row["stake_sum"], winnings=row["winnings_sum"])
    return lote
