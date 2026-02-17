from auth import match_ci_publisher
from models import CiPublisher, CiPublisherProvider


def _claims(
    *,
    iss: str = "https://issuer.example/",
    aud="https://dxcp-api",
    sub: str = "github:org/repo:ref:refs/heads/main",
    azp: str = "github-actions",
    email: str = "ci-bot@example.com",
) -> dict:
    return {
        "iss": iss,
        "aud": aud,
        "sub": sub,
        "azp": azp,
        "email": email,
    }


def test_match_ci_publisher_exact_subject_match():
    claims = _claims(sub="auth0|ci-user-1")
    publishers = [
        CiPublisher(
            name="github-prod",
            provider=CiPublisherProvider.GITHUB,
            subjects=["auth0|ci-user-1"],
        )
    ]
    assert match_ci_publisher(claims, publishers) == "github-prod"


def test_match_ci_publisher_email_match():
    claims = _claims(email="pipeline@company.com")
    publishers = [
        CiPublisher(
            name="jenkins-main",
            provider=CiPublisherProvider.JENKINS,
            emails=["pipeline@company.com"],
        )
    ]
    assert match_ci_publisher(claims, publishers) == "jenkins-main"


def test_match_ci_publisher_azp_match():
    claims = _claims(azp="trusted-client")
    publishers = [
        CiPublisher(
            name="spinnaker-control-plane",
            provider=CiPublisherProvider.SPINNAKER,
            authorized_party_azp=["trusted-client"],
        )
    ]
    assert match_ci_publisher(claims, publishers) == "spinnaker-control-plane"


def test_match_ci_publisher_enforces_issuer_and_audience_constraints():
    claims = _claims(iss="https://issuer.one/", aud=["https://dxcp-api", "openid"])
    publishers = [
        CiPublisher(
            name="issuer-aud-gated",
            provider=CiPublisherProvider.CUSTOM,
            issuers=["https://issuer.one/"],
            audiences=["https://dxcp-api"],
            subject_prefixes=["github:"],
        )
    ]
    assert match_ci_publisher(claims, publishers) == "issuer-aud-gated"

    wrong_issuer = _claims(iss="https://issuer.two/", aud=["https://dxcp-api"])
    assert match_ci_publisher(wrong_issuer, publishers) is None

    wrong_audience = _claims(iss="https://issuer.one/", aud=["https://other-api"])
    assert match_ci_publisher(wrong_audience, publishers) is None


def test_match_ci_publisher_multiple_publishers_only_one_matches():
    claims = _claims(
        iss="https://auth.example/",
        aud=["https://dxcp-api"],
        sub="repo:acme/service:ref:refs/heads/main",
        azp="gha-client",
        email="ci@acme.com",
    )
    publishers = [
        CiPublisher(
            name="jenkins",
            provider=CiPublisherProvider.JENKINS,
            issuers=["https://jenkins.example/"],
        ),
        CiPublisher(
            name="github-main",
            provider=CiPublisherProvider.GITHUB,
            issuers=["https://auth.example/"],
            audiences=["https://dxcp-api"],
            authorized_party_azp=["gha-client"],
            subject_prefixes=["repo:acme/service:"],
        ),
        CiPublisher(
            name="spinnaker",
            provider=CiPublisherProvider.SPINNAKER,
            emails=["deploy@acme.com"],
        ),
    ]
    assert match_ci_publisher(claims, publishers) == "github-main"


def test_match_ci_publisher_ambiguous_match_deterministic_tie_breaker():
    claims = _claims(sub="auth0|ci-user-1")
    publishers = [
        CiPublisher(
            name="z-publisher",
            provider=CiPublisherProvider.CUSTOM,
            subjects=["auth0|ci-user-1"],
        ),
        CiPublisher(
            name="a-publisher",
            provider=CiPublisherProvider.CUSTOM,
            subjects=["auth0|ci-user-1"],
        ),
    ]
    assert match_ci_publisher(claims, publishers) == "a-publisher"
