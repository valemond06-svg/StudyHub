"""Test per il privacy filter di StudyHub."""
import pytest
import os
from studyhub.ai.privacy import (
    analyze_sensitivity,
    check_external_allowed,
    scope,
    current_scope,
)


class TestAnalyzeSensitivity:
    """Test analisi sensibilità contenuti."""

    def test_none_sensitive(self):
        sens, reasons = analyze_sensitivity("Cos'è la derivata di x^2?")
        assert sens == "none"
        assert reasons == []

    def test_low_university_content(self):
        sens, reasons = analyze_sensitivity("L'esame di Analisi 2 è difficile")
        assert sens == "medium"  # university keywords -> medium
        assert "Contenuto didattico universitario" in reasons

    def test_medium_student_id(self):
        sens, reasons = analyze_sensitivity("La mia matricola è 1234567")
        assert sens == "medium"
        assert any("matricola" in r.lower() for r in reasons)

    def test_medium_email(self):
        sens, reasons = analyze_sensitivity("Email: mario.rossi@studenti.univr.it")
        assert sens == "medium"
        assert any("email" in r.lower() for r in reasons)

    def test_high_cf(self):
        sens, reasons = analyze_sensitivity("CF: RSSMRA80A01H501U")
        assert sens == "high"
        assert any("codice fiscale" in r.lower() for r in reasons)

    def test_high_iban_valid(self):
        # IBAN italiano valido (test)
        sens, reasons = analyze_sensitivity("IBAN: IT60X0542811101000000123456")
        assert sens == "high"
        assert any("iban" in r.lower() for r in reasons)

    def test_high_financial_keywords(self):
        sens, reasons = analyze_sensitivity("Estratto conto bancario di luglio")
        assert sens == "high"
        assert any("finanziar" in r.lower() or "credential" in r.lower() for r in reasons)

    def test_high_credit_card_luhn(self):
        # Visa test number (Luhn valid)
        sens, reasons = analyze_sensitivity("Carta: 4111 1111 1111 1111")
        assert sens == "high"
        assert any("carta" in r.lower() for r in reasons)


class TestCheckExternalAllowed:
    """Test decisione privacy per provider esterni."""

    def setup_method(self):
        # Reset environment per ogni test
        os.environ["STUDYHUB_PRIVACY_MODE"] = "strict"

    def test_local_only_mode(self):
        os.environ["STUDYHUB_PRIVACY_MODE"] = "local_only"
        # Riimporta per aggiornare mode
        from importlib import reload
        import studyhub.ai.privacy as privacy_mod
        reload(privacy_mod)

        decision = privacy_mod.check_external_allowed("gemini", "Cos'è la derivata?")
        assert decision.allowed is False
        assert "LOCAL_ONLY" in decision.reason

    def test_strict_blocks_high_sensitivity(self):
        decision = check_external_allowed("gemini", "CF: RSSMRA80A01H501U")
        assert decision.allowed is False
        assert decision.sensitivity == "high"
        assert "Codice fiscale" in decision.reason

    def test_strict_blocks_medium_sensitivity(self):
        decision = check_external_allowed("gemini", "La mia matricola è 1234567")
        assert decision.allowed is False
        assert decision.sensitivity == "medium"
        assert "strict" in decision.reason.lower()

    def test_permissive_allows_medium(self):
        os.environ["STUDYHUB_PRIVACY_MODE"] = "permissive"
        from importlib import reload
        import studyhub.ai.privacy as privacy_mod
        reload(privacy_mod)

        decision = privacy_mod.check_external_allowed("gemini", "La mia matricola è 1234567")
        assert decision.allowed is True
        assert decision.sensitivity == "medium"
        assert "permissive" in decision.reason.lower()

    def test_strict_allows_none(self):
        decision = check_external_allowed("gemini", "Cos'è la derivata?")
        assert decision.allowed is True
        assert decision.sensitivity == "none"

    def test_private_job_blocks(self):
        decision = check_external_allowed("gemini", "Cos'è la derivata?", kind="exam_answers")
        assert decision.allowed is False
        assert "privato" in decision.reason.lower()

    def test_private_flag_blocks(self):
        decision = check_external_allowed("gemini", "Cos'è la derivata?", private=True)
        assert decision.allowed is False
        assert "privato" in decision.reason.lower()

    def test_context_scope_private_blocks(self):
        with scope(kind="transcript", private=True):
            decision = check_external_allowed("gemini", "Cos'è la derivata?")
            assert decision.allowed is False
            assert "privato" in decision.reason.lower()

    def test_claude_same_as_gemini(self):
        decision = check_external_allowed("claude", "Matricola 1234567")
        assert decision.allowed is False
        assert decision.sensitivity == "medium"


class TestScopeContext:
    """Test context manager per scope privacy."""

    def test_nested_scope_accumulates(self):
        with scope(kind="exam_answers"):
            ctx1 = current_scope()
            assert "exam_answers" in ctx1["kinds"]
            with scope(kind="transcript"):
                ctx2 = current_scope()
                assert "exam_answers" in ctx2["kinds"]
                assert "transcript" in ctx2["kinds"]
            ctx3 = current_scope()
            assert "exam_answers" in ctx3["kinds"]
            assert "transcript" not in ctx3["kinds"]

    def test_private_flag_inherits(self):
        with scope(private=True):
            ctx = current_scope()
            assert ctx["private"] is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])