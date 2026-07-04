import fetch from 'node-fetch';

export default async function handler(req, res) {
  const githubToken = process.env.GITHUB_PAT;
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  const username = process.env.GITHUB_USERNAME;

  const today = new Date().toISOString().split('T')[0];
  const logs = [];

  try {
    if (!username || !githubToken) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing GITHUB_USERNAME or GITHUB_PAT environment variables." 
      });
    }

    const commonHeaders = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${githubToken.trim()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Vercel-Automated-Traffic-App'
    };

    // 1. DYNAMICALLY FETCH ALL YOUR REPOSITORIES
    // affiliation: "owner" ensures we only get YOUR repos, not ones you contributed to.
    // per_page: 100 pulls up to 100 repositories in one go.
    const reposResponse = await fetch(`https://api.github.com/user/repos?type=owner&per_page=100`, {
      headers: commonHeaders
    });

    if (!reposResponse.ok) {
      throw new Error(`Failed to fetch repository list from GitHub: ${reposResponse.statusText}`);
    }

    const allRepos = await reposResponse.json();
    
    // Extract just the string names of your repositories
    const repoNames = allRepos.map(repo => repo.name);

    if (repoNames.length === 0) {
      return res.status(200).json({ success: true, message: "No repositories found for this account." });
    }

    // 2. LOOP THROUGH EVERY REPO FOUND AUTOMATICALLY
    for (const repo of repoNames) {
      const trafficResponse = await fetch(`https://api.github.com/repos/${username}/${repo}/traffic/views`, {
        headers: commonHeaders
      });

      // If a single repo fails (like an empty repo with no data), we skip it and keep going
      if (!trafficResponse.ok) {
        logs.push(`${repo}: Skipped (GitHub returned ${trafficResponse.status})`);
        continue;
      }

      const trafficData = await trafficResponse.json();
      const totalViews = trafficData.count || 0;
      const uniqueVisitors = trafficData.uniques || 0;

      // 3. SEND THE METRICS TO NOTION
      await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken.trim()}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          parent: { database_id: databaseId.trim() },
          properties: {
            "Name": { title: [{ text: { content: today } }] },
            "Repository": { rich_text: [{ text: { content: repo } }] },
            "Total Views": { number: totalViews },
            "Unique Visitors": { number: uniqueVisitors }
          }
        })
      });

      logs.push(`${repo}: Logged ${totalViews} views.`);
    }

    return res.status(200).json({ success: true, totalProcessed: repoNames.length, details: logs });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
