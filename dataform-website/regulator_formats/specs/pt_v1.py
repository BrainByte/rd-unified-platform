# ============================================================================
# PT — SRIJ Safe file categories as a MAPPING SPEC (pure data).
#
# Portugal (docs/regulator/pt/pt-data-model.md) is a batch-file regime:
# the Captor deposits hourly XML files per category into the in-country
# Safe. Formats follow the schemas the gazette itself prints in Anexo 1
# of Regulamento n.º 903-B/2015, transcribed with flagged repairs into
# docs/regulator/pt/derived/ — which is also this spec's VALIDATION
# ORACLE (test_pt_spec.py validates every golden against those XSDs).
#
#   players  -> JGDR_ registration/update record   (JGDR.xsd)
#   payments -> TRAN_ wallet movement, DEBITO/CREDITO with saldo triplet
#   bets     -> AJOG_ sport sub-record with a_*/g_*/r_* balance triplets
#   gaming   -> AJOG_ sub-record by vertical: SLOTS -> fortazar,
#               BLACKJACK -> bjack, POKER -> poker (operator-jackpot
#               rounds are not homologated and are suppressed upstream)
#
# Demo simplifications, declared once: one enveloped <ficheiro> per
# canonical record instead of the hourly batch (the envelope fields are
# the real ones — cod_entexpl, datahr, id_ficheiro, cod_cofre); the
# gazette types cod_entexpl as xs:byte and id_ficheiro as xs:short, so
# the operator code is a fixture "77" and the file id derives crc-mod;
# full-KYC fields the demo does not capture (nome, morada, telefone…)
# and poker table/card detail carry declared placeholders; the demo
# wallet has no bonus/poker-prize compartments, so those triplets are
# zero; SESS_/RESF_/EXCL_ have no canonical source and are out of scope.
# ============================================================================

_MONEY0 = {"const": "0.00"}


def _ENVELOPE(registos_name, registos_binding, file_kind):
    """The common file envelope every category root <ficheiro> opens with
    (Anexo 1, all category schemas), wrapping this file's record list."""
    return {
        "cod_entexpl": {"config": "operator_code"},          # xs:byte in the gazette
        "datahr": {"now": True, "as": "digits14"},
        "id_ficheiro": {"crc": [file_kind, "$record_key"], "mod": 30000},  # xs:short
        "cod_cofre": {"config": "cofre_code"},
        registos_name: registos_binding,
    }


# common leading fields of every AJOG_ sub-record (cod_ficha .. timestp)
def _AJOG_COMMON(key_field, start_field, end_field):
    return {
        "cod_ficha": {"from": key_field},
        "cod_aptr_jog": {"from": key_field},
        "ap_cruz": {"const": "N"},
        "timestp_ini": {"from": start_field, "as": "digits14-fftz"},
        "timestp_fim": {"from": end_field, "as": "digits14-fftz"},
        "dathr_ini_evento": {"from": start_field, "as": "digits14"},
        "dathr_fim_evento": {"from": end_field, "as": "digits14"},
        "cod_fichajog": {"format": "{record_key}-J"},
        "id_sessao": {"from": "session_id", "fallback": "0"},
        "ip_jogador": {"const": "0.0.0.0"},        # demo captures no client IP
        "ip_regiao": {"const": "PT"},
        "cod_opejog": {"format": "{record_key}-OP"},
        "timestp": {"from": end_field, "as": "digits14-fftz"},
    }


# stake / winnings / refund balance triplets shared by every sub-record;
# fed by the ledger-derived canonical balance fields (_balances() in
# submission.py, built for FR). A void refunds the stake (r_*); a settled
# bet pays g_ganho (0 when lost) — variants keep each triplet consistent.
_TRIPLETS = {
    "a_saldo_ini": {"from": "balance_before_stake", "as": "money"},
    "a_valor": {"from": "stake", "as": "money"},
    "a_saldo_fim": {"from": "balance_after_stake", "as": "money"},
    "a_bonus_ini": _MONEY0,
    "a_bonus": _MONEY0,
    "a_bonus_fim": _MONEY0,
    "a_comissao": _MONEY0,
    "g_saldo_ini": {"from": "balance_before_credit", "as": "money"},
    "g_ganho": [
        {"when": {"field": "status", "equals": "VOIDED"}, "const": "0.00"},
        {"from": "payout", "as": "money"},
    ],
    "g_saldo_fim": [
        {"when": {"field": "status", "equals": "VOIDED"},
         "from": "balance_before_credit", "as": "money"},
        {"from": "balance_after_credit", "as": "money"},
    ],
    "r_saldo_ini": [
        {"when": {"field": "status", "equals": "VOIDED"},
         "from": "balance_before_credit", "as": "money"},
        {"from": "balance_after_credit", "as": "money"},
    ],
    "r_valor": [
        {"when": {"field": "status", "equals": "VOIDED"},
         "from": "stake", "as": "money"},
        {"const": "0.00"},
    ],
    "r_saldo_fim": {"from": "balance_after_credit", "as": "money"},
}

# sport sub-record inserts g_saldo_ini BEFORE a_comissao (gazette order)
_SPORT_TRIPLETS = {k: _TRIPLETS[k] for k in (
    "a_saldo_ini", "a_valor", "a_saldo_fim",
    "a_bonus_ini", "a_bonus", "a_bonus_fim", "g_saldo_ini")}
_SPORT_TRIPLETS["a_comissao"] = _MONEY0
for _k in ("g_ganho", "g_saldo_fim", "r_saldo_ini", "r_valor", "r_saldo_fim"):
    _SPORT_TRIPLETS[_k] = _TRIPLETS[_k]

_CASINO_TAIL = {k: _TRIPLETS[k] for k in (
    "a_saldo_ini", "a_valor", "a_saldo_fim",
    "a_bonus_ini", "a_bonus", "a_bonus_fim", "a_comissao",
    "g_saldo_ini", "g_ganho", "g_saldo_fim",
    "r_saldo_ini", "r_valor", "r_saldo_fim")}

# the per-player account snapshot inside AJOG_ (cash / bonus / poker-prize
# triplets; the demo wallet is cash-only)
_CONTA_JOG = {"children": {
    "codigo": {"from": "player_ref"},
    "saldo_ini": {"from": "balance_before_stake", "as": "money"},
    "saldo_mov": {"from": "balance_net", "as": "money"},
    "saldo_fim": {"from": "balance_after_credit", "as": "money"},
    "bonus_ini": _MONEY0, "bonus_mov": _MONEY0, "bonus_fim": _MONEY0,
    "pinscr_ini": _MONEY0, "pinscr_mov": _MONEY0, "pinscr_fim": _MONEY0,
}}


def _AJOG_FICHEIRO(apostas_children, key_field):
    """One AJOG_ <ficheiro> whose registos_jogo holds this record's player
    block (demo: one record per file — see the module header)."""
    return {
        "element": "ficheiro",
        "fields": _ENVELOPE("registos_jogo", {"children": {
            "jogador": {"children": {
                "codjogador": {"from": "player_ref"},
                "logon": {"from": "username", "fallback_field": "player_ref"},
                "conta_jog": _CONTA_JOG,
                "apostas": {"children": apostas_children},
            }},
        }}, "AJOG"),
    }


SPEC = {
    "market": "PT",
    "schema_version": "903-B/2015 (derived)",

    "config": {
        "operator_code": "77",    # cod_entexpl — xs:byte in the gazette (fixture)
        "cofre_code": "2AA",      # cod_cofre — the GameVault code (gazette example)
    },

    # no spec-level envelope: each category root IS <ficheiro>

    "records": {

        # a settled/voided fixed-odds bet as an AJOG_ sport sub-record
        "bets": _AJOG_FICHEIRO({
            "sport": {"children": {
                **_AJOG_COMMON("slip_id", "placed_at", "terminal_at"),
                "descr_ap": {"from": "event"},
                "combinado": {"const": "N"},
                "multipla": {"const": "N"},
                "cota_ap": {"from": "odds", "as": "money"},
                # generic result codes: 0 lost, 1 won (Anexo 1 field comments)
                "resultado": [
                    {"when": {"field": "payout", "positive": True}, "const": "1"},
                    {"const": "0"},
                ],
                **_SPORT_TRIPLETS,
            }},
        }, "slip_id"),

        # one completed wallet movement as a TRAN_ record
        "payments": {
            "element": "ficheiro",
            "fields": _ENVELOPE("registos_conta", {"children": {
                "conta": {"children": {
                    "codjogador": {"from": "player_ref"},
                    "cod_conta": {"from": "player_ref"},
                    # player-bank <-> gaming-account: deposit credits the
                    # gaming account, withdrawal debits it
                    "cod_optct": {"from": "direction",
                                  "map": {"DEPOSIT": "CREDITO",
                                          "WITHDRAWAL": "DEBITO"}},
                    "timestp_op": {"from": "completed_at", "as": "digits14-fftz"},
                    "saldo_ini": {"from": "balance_before", "as": "money"},
                    "saldo_mov": {"from": "amount", "as": "money"},
                    "saldo_fim": {"from": "balance", "as": "money"},
                }},
            }}, "TRAN"),
        },

        # a registration or KYC update as a JGDR_ record. The regime is
        # full-KYC; identity fields the demo does not capture carry
        # DECLARED placeholders (fictitious demo), as FR's OUVINFOPERSO.
        "players": {
            "element": "ficheiro",
            "fields": _ENVELOPE("registos_jogador", {"children": {
                "jogador": {"children": {
                    "codjogador": {"from": "player_ref"},
                    "conta_jog": {"from": "player_ref"},
                    "tip_pag": {"const": "OUTRO"},   # code list not published
                    "logon": {"from": "username", "fallback_field": "player_ref"},
                    "id_cidadao": {"from": "national_id", "fallback_field": "player_ref"},
                    "id_tipocid": {"const": "4"},    # 4 = OUTRO
                    "timestp_reg": {"from": "opened_at", "as": "digits14-fftz"},
                    "alias_jog": {"from": "username", "fallback_field": "player_ref"},
                    "nome": {"from": "username", "fallback": "NaoDisponivel"},
                    "data_nascimento": {"from": "date_of_birth", "as": "date-compact",
                                        "when": {"field": "date_of_birth", "present": True}},
                    "nif": {"from": "national_id", "fallback": "000000000"},
                    "morada": {"const": "NaoDisponivel"},
                    "cod_postal": {"const": "0000-000"},
                    "id_nacao": {"const": "PT"},
                    "telefone": {"const": "000000000"},
                    "email": {"format": "{username}@betnova.example"},
                    "resp_at": {"const": "NA"},      # AT service not integrated
                    "id_resp_at": {"const": "NA"},
                }},
            }}, "JGDR"),
        },

        # a platform session as a SESS_ file: LOGIN and LOGOUT log rows
        # (an INACTIVITY disconnect is a LOGOUT on the wire — the schema's
        # tipo_log knows only LOGIN/LOGOUT; the end reason stays in the
        # pipeline tables). REQ: requirements/session-tracking (REQ-ST-6)
        "sessions": {
            "element": "ficheiro",
            "fields": _ENVELOPE("registos_log", {"children": {
                "jogador": {"each": "events", "children": {
                    "codjogador": {"from": "player_ref"},
                    "id_sessao": {"from": "session_id"},
                    "timestp_acao": {"from": "at", "as": "digits14-fftz"},
                    "tipo_log": {"from": "tipo"},
                    "dispositivo": {"const": "C"},   # demo captures no device
                }},
            }}, "SESS"),
        },

        # a casino round as the homologated AJOG_ sub-record family for its
        # vertical; only licensed verticals reach PT (suppression upstream)
        "gaming": _AJOG_FICHEIRO({
            "poker": {"when": {"field": "game", "equals": "POKER"}, "children": {
                **_AJOG_COMMON("round_id", "played_at", "played_at"),
                "id_inscricao": {"from": "session_id", "fallback_field": "round_id"},
                "id_partida": {"from": "round_id"},
                "descr": {"format": "Poker {game}"},
                "torneio": {"const": "N"},           # demo rounds are cash-style
                "id_mesa": {"const": "NA"},          # no table detail in the demo
                "njog_min": {"const": "2"},
                "njog_max": {"const": "9"},
                "comp_oper": _MONEY0,
                "buyin": {"from": "stake", "as": "money"},
                "buyin_pool": _MONEY0,
                "a_lim_min": _MONEY0,
                "a_lim_max": _MONEY0,
                "nr_creditos": {"const": "0"},
                "marca_jog": {"const": "N"},
                "cartas_m": {"const": "NA"},         # demo holds no card detail
                "cartas_j": {"const": "NA"},
                "posicao_mesa": {"const": "0"},
                "resultado": [
                    {"when": {"field": "payout", "positive": True}, "const": "1"},
                    {"const": "0"},
                ],
                **_CASINO_TAIL,
                # poker-tournament prize triplet (demo rounds are cash-style)
                "pinscr_ini": _MONEY0,
                "pinscr_mov": _MONEY0,
                "pinscr_fim": _MONEY0,
            }},
            "bjack": {"when": {"field": "game", "equals": "BLACKJACK"}, "children": {
                **_AJOG_COMMON("round_id", "played_at", "played_at"),
                "id_inscricao": {"from": "session_id", "fallback_field": "round_id"},
                "id_partida": {"from": "round_id"},
                "descr": {"const": "Blackjack"},
                "id_mesa": {"const": "NA"},
                "njog_max": {"const": "7"},
                "cartas_m": {"const": "NA"},
                "cartas_j": {"const": "NA"},
                "posicao_mesa": {"const": "0"},
                "resultado": [
                    {"when": {"field": "payout", "positive": True}, "const": "1"},
                    {"const": "0"},
                ],
                **_CASINO_TAIL,
            }},
            # fortazar carries no <resultado>: the outcome lives in the
            # per-game result fields and the g_* triplet (gazette order)
            "fortazar": {"when": {"field": "game", "equals": "SLOTS"}, "children": {
                **_AJOG_COMMON("round_id", "played_at", "played_at"),
                "descr_ap": {"const": "Slots"},
                "ro_result_nr": {"const": "0"},      # roulette fields n/a to slots
                "ro_result_cor": {"const": "NA"},
                "sm_result": {"const": "NA"},        # demo holds no reel detail
                "bin_cartao": {"const": "NA"},
                "bin_result": {"const": "NA"},
                **_CASINO_TAIL,
            }},
        }, "round_id"),
    },
}
