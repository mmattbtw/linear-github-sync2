import { CheckIcon, DoubleArrowUpIcon } from "@radix-ui/react-icons";
import React, { useCallback, useEffect, useState } from "react";
import { GitHubContext, GitHubRepo } from "../typings";
import { getGitHubAuthURL, saveGitHubContext, setGitHubWebook } from "../utils";
import { v4 as uuid } from "uuid";
import { GITHUB } from "../utils/constants";

interface IProps {
    onAuth: (apiKey: string) => void;
    onDeployWebhook: (context: GitHubContext) => void;
    restored: boolean;
}

const GitHubAuthButton = ({ onAuth, onDeployWebhook, restored }: IProps) => {
    const [accessToken, setAccessToken] = useState("");
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [chosenRepo, setChosenRepo] = useState<GitHubRepo>();
    const [user, setUser] = useState<GitHubRepo>();
    const [deployed, setDeployed] = useState(false);
    const [loading, setLoading] = useState(false);

    const openAuthPage = () => {
        // Generate random code to validate against CSRF attack
        const verificationCode = `github-${uuid()}`;
        localStorage.setItem("github-verification", verificationCode);

        const authURL = getGitHubAuthURL(verificationCode);
        window.location.replace(authURL);
    };

    // If present, exchange the temporary auth code for an access token
    useEffect(() => {
        if (accessToken) return;

        // If the URL params have an auth code, we're returning from the GitHub auth page
        const authResponse = new URLSearchParams(window.location.search);
        if (!authResponse.has("code")) return;

        // Ensure the verification code is unchanged
        const verificationCode = localStorage.getItem("github-verification");
        if (!authResponse.get("state")?.includes("github")) return;
        if (authResponse.get("state") !== verificationCode) {
            alert("GitHub auth returned an invalid code. Please try again.");
            return;
        }

        const refreshToken = authResponse.get("code");
        const redirectURI = window.location.origin;

        // Exchange auth code for access token
        fetch("/api/github/token", {
            method: "POST",
            body: JSON.stringify({ refreshToken, redirectURI }),
            headers: { "Content-Type": "application/json" }
        })
            .then(res => res.json())
            .then(body => {
                if (body.access_token) setAccessToken(body.access_token);
                else alert("No access token returned. Please try again.");
            })
            .catch(err => alert(`Error fetching access token: ${err}`));
    }, []);

    // Fetch the user's repos when a token is available
    useEffect(() => {
        if (!accessToken) return;

        onAuth(accessToken);

        fetch(GITHUB.LIST_REPOS_ENDPOINT, {
            headers: { Authorization: `Bearer ${accessToken}` }
        })
            .then(res => res.json())
            .then(res => {
                setRepos(
                    res.map(repo => {
                        return { id: repo.id, name: repo.full_name };
                    })
                );
            })
            .catch(err => alert(`Error fetching repos: ${err}`));

        fetch(GITHUB.USER_ENDPOINT, {
            headers: { Authorization: `Bearer ${accessToken}` }
        })
            .then(res => res.json())
            .then(res => setUser({ id: res.id, name: res.login }))
            .catch(err => alert(`Error fetching user profile: ${err}`));
    }, [accessToken]);

    // Disable webhook deployment button if the repo already exists
    useEffect(() => {
        if (!chosenRepo) return;

        setLoading(true);

        fetch(`/api/github/repo/${chosenRepo.id}`)
            .then(res => res.json())
            .then(res => {
                if (res?.exists) {
                    setDeployed(true);
                    onDeployWebhook({
                        userId: user.id,
                        repoId: chosenRepo.id,
                        apiKey: accessToken
                    });
                } else {
                    setDeployed(false);
                }
                setLoading(false);
            })
            .catch(err => {
                alert(`Error checking for existing repo: ${err}`);
                setLoading(false);
            });
    }, [chosenRepo]);

    const deployWebhook = useCallback(() => {
        if (!chosenRepo || deployed) return;

        const webhookSecret = `${uuid()}`;
        saveGitHubContext(chosenRepo, webhookSecret).catch(err =>
            alert(`Error saving repo to DB: ${err}`)
        );

        setGitHubWebook(accessToken, chosenRepo, webhookSecret)
            .then(res => res.json())
            .then(res => {
                if (res.errors) {
                    alert(res.errors[0].message);
                    return;
                }
                setDeployed(true);
                onDeployWebhook({
                    userId: user.id,
                    repoId: chosenRepo.id,
                    apiKey: accessToken
                });
            })
            .catch(err => alert(`Error deploying webhook: ${err}`));
    }, [accessToken, chosenRepo, deployed, user]);

    return (
        <div className="center space-y-8 w-80">
            <button onClick={openAuthPage} disabled={!!accessToken || restored}>
                <span>Connect GitHub</span>
                {(!!accessToken || restored) && (
                    <CheckIcon className="w-6 h-6" />
                )}
            </button>
            {repos.length > 0 && (
                <div className="flex flex-col items-center space-y-4">
                    <select
                        disabled={deployed || loading}
                        onChange={e => {
                            setChosenRepo(
                                repos.find(repo => repo.id == e.target.value)
                            );
                        }}
                    >
                        <option value="" disabled selected>
                            Select your repo
                        </option>
                        {repos.map(repo => (
                            <option key={repo.id} value={repo.id}>
                                {repo.name}
                            </option>
                        ))}
                    </select>
                    {chosenRepo && (
                        <button
                            onClick={deployWebhook}
                            disabled={deployed || loading}
                            className={`${loading ? "animate-pulse" : ""}`}
                        >
                            <span>Deploy webhook</span>
                            {deployed ? (
                                <CheckIcon className="w-6 h-6" />
                            ) : (
                                <DoubleArrowUpIcon className="w-6 h-6" />
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default GitHubAuthButton;

